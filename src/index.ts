import fetch from 'node-fetch';
import FormData from 'form-data';
import { EventEmitter, PassThrough, Writable } from 'stream';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AbortController, AbortSignal } from 'abort-controller';

export type TUploadConfig = {
  uploadUrl: string;
  fileName?: string;
  randomBytesCount?: number;
  headers?: any;
  agent?: any;
  method?: string;
};

export type TConfig = {
  saveToLocalPath?: string;
  calculateMD5?: boolean;
  logger?: any;
  agent?: any;
};

export type TResult = {
  url: string;
  size: number;
  filename: string;
  md5?: string;
  local?: TLocalResult;
  uploads: TUploadResult[];
};

export type TLocalResult = {
  path: string;
  size: number;
};

export type TUploadResult = {
  uploadUrl: string;
  size: number;
  uploadedByes: number;
  fileName?: string;
  randomBytesCount?: number;
  md5?: string;
  response?: any;
  error?: string;
};

interface IUploadInternals {
  stream: PassThrough;
  size?: number;
  uploadedByes: number;
  uploadUrl: string;
  fileName?: string;
  randomBytesCount?: number;
  headers?: any;
  agent?: any;
  method: string;
  md5Result?: string;
  resetTimeout(): void;
  setSize(size: number): void;
  writeToStream(chunk: any): boolean;
  finalizeUpload(): void;
  isStreamAlive(): boolean;
  getAbortSignal(): AbortSignal;
  getResult(response?: any, error?: string): TUploadResult;
}

class UploadInternals implements IUploadInternals {
  public index: number;
  private _logger?: any;
  public stream: PassThrough;
  public size?: number;
  public uploadedByes: number;
  public uploadUrl: string;
  public fileName?: string;
  public randomBytesCount?: number;
  public headers?: any;
  public agent?: any;
  public method: string;
  private _md5Hash?: crypto.Hash;
  public md5Result?: string;
  private _abortController: AbortController;
  private _timeoutId?: ReturnType<typeof setTimeout>;
  private _defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
  };

  constructor(upload: TUploadConfig, index: number, config?: TConfig) {
    this.index = index;
    if (config) {
      this._logger = config.logger;
      // Create a new MD5 hash object to calculate the hash of the file
      if (config.calculateMD5) this._md5Hash = crypto.createHash('md5');
    }

    this.uploadUrl = upload.uploadUrl;
    this.fileName = upload.fileName;
    this.randomBytesCount = upload.randomBytesCount;
    this.headers = upload.headers || this._defaultHeaders;
    this.agent = upload.agent;
    this.method = upload.method || 'POST';
    this.stream = new PassThrough({ highWaterMark: 1024 * 1024 * 20 });
    this._abortController = new AbortController();
    this.uploadedByes = 0;

    this._logger?.log(
      `Upload stream ${this.index} prepared: ${this.uploadUrl}`
    );
  }

  abort() {
    this._abortController.abort();
  }

  resetTimeout() {
    this._logger?.debug(`Stream ${this.index} timeout reset`);
    clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(() => {
      this._abortController.abort();
    }, 60000);
  }

  clearTimeout() {
    this._logger?.debug(`Stream ${this.index} timeout cleared`);
    clearTimeout(this._timeoutId);
  }

  setSize(size: number) {
    this.size = size + (this.randomBytesCount || 0);
  }

  setFilename(filename: string) {
    if (!this.fileName) {
      this.fileName = filename;
    }
  }

  writeToStream(chunk: any): boolean {
    // Add uploaded bytes to counter
    this.uploadedByes += chunk.byteLength;

    // Update md5 hash if we need to calculate
    this._md5Hash?.update(chunk);

    return this.stream.write(chunk);
  }

  finalizeUpload() {
    if (this.randomBytesCount) {
      let buffer = crypto.randomBytes(this.randomBytesCount);
      this.stream.write(buffer);
      this._md5Hash?.update(buffer);

      // Add uploaded bytes to counter
      this.uploadedByes += buffer.byteLength;
    }
    this.md5Result = this._md5Hash?.digest('hex');
    // Upload finalized, we can clear timeout
    this.clearTimeout();
  }

  isStreamAlive(): boolean {
    if (this.stream.destroyed || this.stream.closed || this.stream.errored) {
      return false;
    } else {
      return true;
    }
  }

  getAbortSignal(): AbortSignal {
    return this._abortController.signal;
  }

  getPromise(): Promise<TUploadResult> {
    return new Promise(async (resolve, reject) => {
      try {
        let res;
        if (this.method === 'PUT') {
          res = await fetch(this.uploadUrl, {
            method: this.method,
            body: this.stream,
            headers: this.headers,
            agent: this.agent,
            signal: this.getAbortSignal()
          });
        } else {
          const formData = new FormData();
          formData.append('file', this.stream, {
            filename: this.fileName,
            knownLength: this.size
          });

          res = await fetch(this.uploadUrl, {
            method: this.method,
            body: formData,
            headers: this.headers,
            agent: this.agent,
            signal: this.getAbortSignal()
          });
        }

        this._logger?.log(`Upload completed: ${this.uploadUrl}`);
        const body = await res.text();
        try {
          const json = JSON.parse(body);
          resolve(this.getResult(json));
        } catch (err) {
          this._logger?.log(`Failed to parse response as JSON, returnign text`);
          resolve(this.getResult(body));
        }
      } catch (error) {
        this._logger?.error(`Error uploading to ${this.uploadUrl}: `, error);

        let errorMessage = (error as Error).message;
        reject(this.getResult(null, errorMessage));
      }

      this.stream.on('error', (error) => {
        this._logger?.error('Error in upload stream: ', error);
        reject(this.getResult(null, error.message));
      });
    });
  }

  getResult(response?: any, error?: string): TUploadResult {
    // Clear timeout as the upload is completed if this was called
    this.clearTimeout();
    this.stream.destroy();

    return {
      uploadUrl: this.uploadUrl,
      fileName: this.fileName,
      size: this.size || 0,
      uploadedByes: this.uploadedByes,
      randomBytesCount: this.randomBytesCount,
      md5: this.md5Result,
      response: response,
      error: error
    };
  }
}

class Uploads extends EventEmitter {
  public uploads: UploadInternals[];

  constructor(uploads: TUploadConfig[], config?: TConfig) {
    super();
    this.uploads = [];
    for (const upload of uploads) {
      // Initialize internal uload object
      let uploadInternal = new UploadInternals(
        upload,
        uploads.indexOf(upload),
        config
      );

      // If upload stream is drained emit even to resume download
      uploadInternal.stream.on('drain', () => {
        this.emit('unstuck', uploadInternal.index);

        // If stream is drained - we clear the timeout, so it can wait for other streams
        uploadInternal.clearTimeout();
      });

      this.uploads.push(uploadInternal);
    }
  }

  setSize(downloadSize: number) {
    for (const upload of this.uploads) {
      upload.setSize(downloadSize);
      upload.resetTimeout();
    }
  }

  setFilename(filename: string) {
    for (const upload of this.uploads) {
      upload.setFilename(filename);
    }
  }

  write(chunk: any) {
    for (const upload of this.uploads) {
      // Skip writng to stream if stream is not in good condition
      if (!upload.isStreamAlive()) {
        continue;
      }

      // Determine if upload stream can write, pasuse download if not
      const canWrite = upload.writeToStream(chunk);
      if (!canWrite) {
        // Stream can't write - means it's faster than the others, pause download
        this.emit('stuck', upload.index);

        // We also clear timeout on this stream, so it will not get aborted while waiting for other streams to finish
        upload.clearTimeout();
      } else {
        // If stream can write - means should be in good condition - reset timeout
        upload.resetTimeout();
      }
    }
  }

  destroyAll(error: any) {
    for (const upload of this.uploads) {
      upload.abort();
      upload.stream.destroy(error);
    }
  }

  finalizeAll() {
    for (const upload of this.uploads) {
      upload.finalizeUpload();
      upload.stream.end();
    }
  }

  isAllStreamsUnusable() {
    let unusableCount = 0;
    for (const upload of this.uploads) {
      if (!upload.isStreamAlive()) {
        unusableCount++;
      }
    }
    if (unusableCount === this.uploads.length) {
      return true;
    } else {
      return false;
    }
  }

  getPromises() {
    // Create a Promise for each server to which the file is being uploaded
    const uploadPromises = this.uploads.map(async (upload) => {
      const uploadPromise = upload.getPromise();

      // Resume download in case one of the upload fails
      uploadPromise.catch(() => {
        upload.stream.destroy();

        // Check if we have some upload stream alive, if not - close download stream
        if (this.isAllStreamsUnusable()) {
          this.emit('unusable');
        } else {
          // Emit unstuck event to resume download, just in case
          this.emit('unstuck', upload.index);
        }
      });

      return uploadPromise;
    });

    return uploadPromises;
  }
}

export class Transload {
  private downloadUrl: string;
  private uploads: Uploads;
  private saveToLocalPath?: string;
  private md5Hash?: crypto.Hash;
  private md5Result?: string;
  private logger?: any;
  private fileStream?: Writable;
  private defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
  };
  private agent?: any;

  constructor(downloadUrl: string, uploads: TUploadConfig[], config?: TConfig) {
    if (config) {
      this.saveToLocalPath = config.saveToLocalPath;
      this.logger = config.logger;
      this.agent = config.agent;

      // Create a new MD5 hash object to calculate the hash of the file
      if (config.calculateMD5) this.md5Hash = crypto.createHash('md5');
    }
    this.downloadUrl = downloadUrl;

    this.uploads = new Uploads(uploads, config);
  }

  private _getFilenameFromHeaders(response: any) {
    let utf8Filename = '';
    const contentDispositionHeader = response.headers.get(
      'Content-Disposition'
    );
    if (contentDispositionHeader) {
      const filenameMatch = contentDispositionHeader.match(
        /filename\*?=(?:UTF-8|ISO-8859-2)?(['"])?([^'";\n]+)\1?/i
      );
      const encodedFilename = filenameMatch ? filenameMatch[2] : '';

      // Decode the filename from the non-UTF-8 character encoding
      utf8Filename = decodeURIComponent(escape(encodedFilename));
    }
    return utf8Filename;
  }

  async transload(): Promise<TResult> {
    this.logger?.log(`Starting download: ${this.downloadUrl}`);
    try {
      const abortController = new AbortController();
      const signal = abortController.signal;

      // Download the file from the URL using fetch
      const response = await fetch(this.downloadUrl, {
        headers: this.defaultHeaders,
        agent: this.agent,
        signal
      });

      // Determine file length from response headers
      const knownLength: number = Number(
        response.headers.get('content-length')
      );
      this.uploads.setSize(knownLength);

      // Extract the filename from the Content-Disposition header, or use the custom filename or default filename
      let utf8Filename = this._getFilenameFromHeaders(response);
      let fileName = utf8Filename || path.basename(this.downloadUrl);
      this.uploads.setFilename(fileName);

      this.uploads.on('unstuck', (streamIndex) => {
        this.logger?.log(`Stream ${streamIndex} unstuck - resuming download`);
        response.body?.resume();
      });

      this.uploads.on('stuck', (streamIndex) => {
        this.logger?.log(`Stream ${streamIndex} stuck - pausing download`);
        response.body?.pause();
      });

      this.uploads.on('unusable', () => {
        if (this.saveToLocalPath) {
          this.logger?.log(
            'No more usable upload streams, but we are saving to local'
          );
          response.body?.resume();
        } else {
          this.logger?.log('No more usable upload streams, aborting download');
          abortController.abort();
        }
      });

      // If a local path is specified, create a write stream to save the file locally
      if (this.saveToLocalPath) {
        this.fileStream = fs.createWriteStream(this.saveToLocalPath);
      }

      // As data is received from the remote server, update the MD5 hash and write it to the upload streams
      let bytesDownloaded = 0;
      response.body?.on('data', (chunk) => {
        bytesDownloaded += chunk.byteLength;
        this.md5Hash?.update(chunk);

        // Write chunk to all upload streams
        this.uploads.write(chunk);

        // Write chunk to local file if configured
        this.fileStream?.write(chunk);
      });

      response.body?.on('error', (error) => {
        this.logger?.log(`Download stream failed: `, error);
        // Propagete the error through all upload streams
        this.uploads.destroyAll(error);
        abortController.abort();
      });

      let fileStreamPromise = new Promise((resolve, reject) => {
        if (!this.saveToLocalPath) {
          resolve(null);
        }
        this.fileStream?.on('finish', () => {
          resolve(null);
        });
      });

      // When all data has been received, end the upload streams for each server
      response.body?.on('end', () => {
        this.uploads.finalizeAll();

        this.fileStream?.end();
        this.md5Result = this.md5Hash?.digest('hex');
        this.logger?.log(`Download complete, MD5 checksum: ${this.md5Result}`);
      });

      // Set an interval to log the download progress every 5 seconds
      const intervalId = setInterval(() => {
        const progress = (bytesDownloaded / knownLength) * 100;
        this.logger?.log(
          `Download progress: ${progress.toFixed(
            2
          )}% @ bytes: ${bytesDownloaded}`
        );
      }, 5000);

      // Prepare upload promises
      let uploadPromises = Promise.allSettled(this.uploads.getPromises());

      // Wait for all promises to complete, including saving to local path
      const results = await Promise.all([uploadPromises, fileStreamPromise]);

      clearInterval(intervalId);

      const uploadResponses = results[0].map((result) =>
        result.status === 'fulfilled' ? result.value : result.reason
      );

      // Add information about local file
      let local: any;
      if (this.saveToLocalPath) {
        local = {
          path: this.saveToLocalPath,
          size: fs.statSync(this.saveToLocalPath).size
        };
      }

      return {
        url: this.downloadUrl,
        size: knownLength,
        filename: fileName,
        md5: this.md5Result,
        local: local,
        uploads: uploadResponses
      };
    } catch (error) {
      this.logger?.log(`Error downloading file ${this.downloadUrl}: `, error);
      throw error;
    }
  }
}
