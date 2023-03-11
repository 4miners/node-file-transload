# node-file-transload

Library for file transload (download and upload, on-the-fly).

- It can download the file and upload it while downloading to multiple remote servers, on-the-fly, without touching the disk.
- It will not buffer the entire shit in memory, so it is suitable for transloading very big files.
- Download stream will wait for upload streams before pulling more data, so the overall speed is limited to the slowest stream (either download or upload one).
- Optionally can save the downloaded file to disk while the file is beign transloaded as well.
- Using [node-fetch@2](https://github.com/node-fetch/node-fetch/tree/2.x) and [form-data](https://github.com/form-data/form-data) for dealing with file transfers.

## Installation

```
npm install node-file-transload
```

## Usage

```js
import { Transload } from 'node-file-transload';

let instance = new Transload(
  downloadUrl,
  [uploadConfig1, uploadConfig2, ...],
  generalConfig
);

let result = await instance.transload();
```

### Options

`generalConfig` options:

```js
{
  saveToLocalPath?: string;   // Path to local filesystem if we want to save transloaded file to disk as well
  calculateMD5?: boolean;     // If true it will calculate MD5 hash for downloaded file and all of the uploads (separately)
  logger?: any;               // Logger instance, for example: console
  agent?: any;                // Custom agent, for example: https-proxy-agent
}
```

`uploadConfig` options:

```js
{
  uploadUrl: string;          // Remote URL of the upload server
  fileName?: string;          // If not provided - it will be fetched from download source (Content-Disposition, then URL)
  randomBytesCount?: number;  // Amount of random bytes to add at the end of the file
  headers?: any;              // Custom headers, if not provided only default 'User-Agent' is used
  agent?: any;                // Custom agent, for example: https-proxy-agent
  method?: string;            // 'POST' (default) or 'PUT'
}
```

## Examples

### Mixed PUT & POST upload

```js
import { Transload } from 'node-file-transload';

// Disable debug logs
console.debug = function () {};

let downloadUrl = 'http://212.183.159.230/5MB.zip';

let firstUpload = {
  uploadUrl: 'https://transfer.sh/5MB.zip',
  headers: { 'User-Agent': 'curl/7.83.1' },
  method: 'PUT'
};

let secondUpload = {
  uploadUrl: 'https://www38.uptobox.com/upload?sess_id=yyy',
  randomBytesCount: 12,
  fileName: 'example.zip'
};

let instance = new Transload(downloadUrl, [firstUpload, secondUpload], {
  calculateMD5: true,
  logger: console
});
let results = await instance.transload();
console.dir(results, { depth: null });
```

Response:

```bash
Upload stream 0 prepared: https://transfer.sh/5MB.zip
Upload stream 1 prepared: https://www38.uptobox.com/upload?sess_id=yyy
Starting download: http://212.183.159.230/5MB.zip
Download progress: 96.77% @ bytes: 5073381
Download complete, MD5 checksum: b3215c06647bc550406a9c8ccc378756
Upload completed: https://www38.uptobox.com/upload?sess_id=yyy
Upload completed: https://transfer.sh/5MB.zip
Failed to parse response as JSON, returnign text
{
  url: 'http://212.183.159.230/5MB.zip',
  size: 5242880,
  filename: '5MB.zip',
  md5: 'b3215c06647bc550406a9c8ccc378756',
  uploads: [
    {
      uploadUrl: 'https://transfer.sh/5MB.zip',
      fileName: '5MB.zip',
      size: 5242880,
      uploadedByes: 5242880,
      randomBytesCount: undefined,
      md5: 'b3215c06647bc550406a9c8ccc378756',
      response: 'https://transfer.sh/xxx/5MB.zip',
      error: undefined
    },
    {
      uploadUrl: 'https://www38.uptobox.com/upload?sess_id=yyy',
      fileName: 'example.zip',
      size: 5242892,
      uploadedByes: 5242892,
      randomBytesCount: 12,
      md5: 'f13c886ef37df5ba64fc2060bc9e2ba3',
      response: {
        files: [
          {
            name: 'example.zip',
            size: 5242892,
            url: 'https://uptobox.com/yyy',
            deleteUrl: 'https://uptobox.com/yyy?killcode=yyy'
          }
        ]
      },
      error: undefined
    }
  ]
}
```

### Save file locally while downloading & uploading

```js
import os from 'os';
import { Transload } from 'node-file-transload';

// Disable debug logs
console.debug = function () {};

let downloadUrl = 'http://212.183.159.230/5MB.zip';
let localPath = os.tmpdir() + '/5MB.zip';

let firstUpload = {
  uploadUrl: 'https://non-existing-domain.com'
};

let instance = new Transload(downloadUrl, [firstUpload], {
  calculateMD5: true,
  saveToLocalPath: localPath,
  logger: console
});
let results = await instance.transload();
console.dir(results, { depth: null });
```

Result:

```bash
Upload stream 0 prepared: https://non-existing-domain.com
Starting download: http://212.183.159.230/5MB.zip
Error uploading to https://non-existing-domain.com:  FetchError: request to https://non-existing-domain.com/ failed, reason: getaddrinfo ENOTFOUND non-existing-domain.com
[...]
No more usable upload streams, but we are saving to local
Download complete, MD5 checksum: b3215c06647bc550406a9c8ccc378756
{
  url: 'http://212.183.159.230/5MB.zip',
  size: 5242880,
  filename: '5MB.zip',
  md5: 'b3215c06647bc550406a9c8ccc378756',
  local: {
    path: '/tmp/5MB.zip',
    size: 5242880
  },
  uploads: [
    {
      uploadUrl: 'https://non-existing-domain.com',
      fileName: '5MB.zip',
      size: 5242880,
      uploadedByes: 13921,
      randomBytesCount: undefined,
      md5: undefined,
      response: null,
      error: 'request to https://non-existing-domain.com/ failed, reason: getaddrinfo ENOTFOUND non-existing-domain.com'
    }
  ]
}
```

## Error handling

- When one or more upload streams fail, the other ones will continue.
- If all upload streams fails - the download request will be aborted.
- I will `throw` and `Error` when download fails at the beginning, if download fails while uploading, it will return the result with corresponding errors for all uploads.

```js
import { Transload } from 'node-file-transload';

// Disable debug logs
console.debug = function () {};

let downloadUrl = 'http://212.183.159.230/5MB.zip';

let firstUpload = {
  uploadUrl: 'https://errored-domain.com'
};

let instance = new Transload(downloadUrl, [firstUpload], {
  calculateMD5: true,
  logger: console
});
let results = await instance.transload();
console.dir(results, { depth: null });
```

Result:

```bash
Upload stream 0 prepared: https://errored-domain.com
Starting download: http://212.183.159.230/5MB.zip
Error uploading to https://errored-domain.com:  FetchError: request to https://errored-domain.com/ failed, reason: getaddrinfo ENOTFOUND errored-domain.com
[...]
No more usable upload streams, aborting download
Download stream failed:  AbortError: The user aborted a request.
[...]
{
  url: 'http://212.183.159.230/5MB.zip',
  size: 5242880,
  filename: '5MB.zip',
  md5: undefined,
  uploads: [
    {
      uploadUrl: 'https://errored-domain.com',
      fileName: '5MB.zip',
      size: 5242880,
      uploadedByes: 13921,
      randomBytesCount: undefined,
      md5: undefined,
      response: null,
      error: 'request to https://errored-domain.com/ failed, reason: getaddrinfo ENOTFOUND errored-domain.com'
    }
  ]
}
```

## Limitations

This library is still in development, there is a lot of stuff to handle still, but it works. ;)
