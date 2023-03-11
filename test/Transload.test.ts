import fetch from 'node-fetch';
import { TResult, TUploadConfig, Transload } from '../src/index';

async function getUploadUrl() {
  let res = await fetch('https://uptobox.com');
  let data = await res.text();
  console.log(data);
  //<form id="fileupload" action="//www104.uptobox.com/upload?sess_id=h8ieSwM88E77I0oDlkaj"
  let uploadUrlRx = /id="fileupload" action="\/\/(.+?)"/;
  let match = uploadUrlRx.exec(data);
  if (match) {
    return match[1];
  }
}

async function deleteUploadedFile(deleteUrl: string) {
  //https://uptobox.com/g0tc21l3efyo?killcode=1fh532smem
  let uploadUrlRx = /https:\/\/uptobox\.com\/(.+?)\?killcode=(.+)$/;
  let match = uploadUrlRx.exec(deleteUrl);
  if (match) {
    let id = match[1];
    let del_id = match[2];
    await fetch(`https://uptobox.com/del_file?id=${id}&del_id=${del_id}`, {
      method: 'POST'
    });
    console.log(`File ${deleteUrl} deleted`);
  }
}

describe('download a file and upload two files at the same time', () => {
  let results: TResult;
  let size: number = 5242880;
  let md5: string = 'b3215c06647bc550406a9c8ccc378756';
  let firstUpload: TUploadConfig;
  let secondUpload: TUploadConfig;
  let filesToDelete: string[] = [];
  let downloadUrl: string = 'http://212.183.159.230/5MB.zip';

  beforeAll(async () => {
    let result = await getUploadUrl();
    let uploadUrl = 'https://' + result;

    // Get info about file size from remote server
    size = Number((await fetch(downloadUrl)).headers.get('content-length'));

    firstUpload = {
      uploadUrl
    };

    secondUpload = {
      uploadUrl,
      fileName: 'test.zip',
      randomBytesCount: 12
    };

    let instance = new Transload(downloadUrl, [firstUpload, secondUpload], {
      calculateMD5: true
    });
    results = await instance.transload();
    console.dir(results, { depth: null });
  }, 60000);

  describe('first upload result', () => {
    it('should be no error', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.error).toBeUndefined();
    });

    it('should have correct upload url', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.uploadUrl).toBe(firstUpload.uploadUrl);
    });

    it('should have correct size', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.size).toBe(size);
    });

    it('should have uploaded bytes equal to size', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.uploadedByes).toBe(uploadResult.size);
    });

    it('should not have random bytes set', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.randomBytesCount).toBeUndefined();
    });

    it('should have correct md5 checksum', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.md5).not.toBeUndefined();
      expect(uploadResult.md5).toBe(md5);
    });

    it('should have correct response', async () => {
      let uploadResult = results.uploads[0];
      expect(typeof uploadResult.response).toBe('object');

      // Server-specific response
      expect(Array.isArray(uploadResult.response.files)).toBe(true);
      let file = uploadResult.response.files[0];
      expect(typeof file).toBe('object');
      expect(file.name).toBe('5MB.zip');
      expect(file.size).toBe(size);
      expect(typeof file.url).toBe('string');
      expect(typeof file.deleteUrl).toBe('string');
      // Collect delete link, so we can cleanup later
      filesToDelete.push(file.deleteUrl);
    });
  });

  describe('second upload result (random bytes, custom name)', () => {
    it('should be no error', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.error).toBeUndefined();
    });

    it('should have correct upload url', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.uploadUrl).toBe(secondUpload.uploadUrl);
    });

    it('should have correct size (filesize + randombytes)', async () => {
      let uploadResult = results.uploads[1];
      let fileSize = size + Number(uploadResult.randomBytesCount);
      expect(uploadResult.size).toBe(fileSize);
    });

    it('should have uploaded bytes equal to size', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.uploadedByes).toBe(uploadResult.size);
    });

    it('should have random bytes set (12)', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.randomBytesCount).toBe(12);
    });

    it('should have different md5 checksum', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.md5).not.toBeUndefined();
      expect(uploadResult.md5).not.toBe(md5);
    });

    it('should have correct response', async () => {
      let uploadResult = results.uploads[1];
      let fileSize = size + Number(uploadResult.randomBytesCount);

      expect(typeof uploadResult.response).toBe('object');

      // Server-specific response
      expect(Array.isArray(uploadResult.response.files)).toBe(true);
      let file = uploadResult.response.files[0];
      expect(typeof file).toBe('object');
      expect(file.name).toBe(secondUpload.fileName);
      expect(file.size).toBe(fileSize);
      expect(typeof file.url).toBe('string');
      expect(typeof file.deleteUrl).toBe('string');
      // Collect delete link, so we can cleanup later
      filesToDelete.push(file.deleteUrl);
    });
  });

  afterAll(async () => {
    // Cleanup - delting all uploaded files
    for (const filetoDelete of filesToDelete) {
      await deleteUploadedFile(filetoDelete);
    }
  }, 60000);
});

describe('download a file and upload two files at the same time (PUT request)', () => {
  let results: TResult;
  let size: number = 5242880;
  let md5: string = 'b3215c06647bc550406a9c8ccc378756';
  let firstUpload: TUploadConfig;
  let secondUpload: TUploadConfig;
  let downloadUrl: string = 'http://212.183.159.230/5MB.zip';

  beforeAll(async () => {
    let uploadUrl1 = 'https://transfer.sh/5MB.zip';
    let uploadUrl2 = 'https://transfer.sh/test.zip';

    // Get info about file size from remote server
    size = Number((await fetch(downloadUrl)).headers.get('content-length'));

    firstUpload = {
      uploadUrl: uploadUrl1,
      headers: { 'User-Agent': 'curl/7.83.1' },
      method: 'PUT'
    };

    secondUpload = {
      uploadUrl: uploadUrl2,
      fileName: 'test.zip',
      randomBytesCount: 12,
      headers: { 'User-Agent': 'curl/7.83.1' },
      method: 'PUT'
    };

    let instance = new Transload(downloadUrl, [firstUpload, secondUpload], {
      calculateMD5: true
    });
    results = await instance.transload();
    console.dir(results, { depth: null });
  }, 60000);

  describe('first upload result', () => {
    it('should be no error', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.error).toBeUndefined();
    });

    it('should have correct upload url', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.uploadUrl).toBe(firstUpload.uploadUrl);
    });

    it('should have correct size', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.size).toBe(size);
    });

    it('should have uploaded bytes equal to size', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.uploadedByes).toBe(uploadResult.size);
    });

    it('should not have random bytes set', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.randomBytesCount).toBeUndefined();
    });

    it('should have correct md5 checksum', async () => {
      let uploadResult = results.uploads[0];
      expect(uploadResult.md5).not.toBeUndefined();
      expect(uploadResult.md5).toBe(md5);
    });

    it('should have correct response', async () => {
      let uploadResult = results.uploads[0];

      //https://transfer.sh/iEQo2f/5MB.zip
      expect(uploadResult.response).toMatch(
        /^https:\/\/transfer\.sh\/.+?\/5MB.zip$/
      );
    });
  });

  describe('second upload result (random bytes, custom name)', () => {
    it('should be no error', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.error).toBeUndefined();
    });

    it('should have correct upload url', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.uploadUrl).toBe(secondUpload.uploadUrl);
    });

    it('should have correct size (filesize + randombytes)', async () => {
      let uploadResult = results.uploads[1];
      let fileSize = size + Number(uploadResult.randomBytesCount);
      expect(uploadResult.size).toBe(fileSize);
    });

    it('should have uploaded bytes equal to size', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.uploadedByes).toBe(uploadResult.size);
    });

    it('should have random bytes set (12)', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.randomBytesCount).toBe(12);
    });

    it('should have different md5 checksum', async () => {
      let uploadResult = results.uploads[1];
      expect(uploadResult.md5).not.toBeUndefined();
      expect(uploadResult.md5).not.toBe(md5);
    });

    it('should have correct response', async () => {
      let uploadResult = results.uploads[1];

      //https://transfer.sh/iEQo2f/test.zip
      expect(uploadResult.response).toMatch(
        /^https:\/\/transfer\.sh\/.+?\/test.zip$/
      );
    });
  });
});
