const send = jest.fn();
const done = jest.fn();
const getSignedUrlMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send })),
  CopyObjectCommand: jest.fn(params => ({ type: 'CopyObjectCommand', params })),
  DeleteObjectCommand: jest.fn(params => ({ type: 'DeleteObjectCommand', params })),
  GetObjectCommand: jest.fn(params => ({ type: 'GetObjectCommand', params })),
  HeadObjectCommand: jest.fn(params => ({ type: 'HeadObjectCommand', params })),
  ListObjectsV2Command: jest.fn(params => ({ type: 'ListObjectsV2Command', params }))
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn(function Upload(config) {
    this.config = config;
    this.done = done;
  })
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args) => getSignedUrlMock(...args)
}));

const CloudStorageManager = require('../../storage/cloudStorageManager');

describe('CloudStorageManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({});
    done.mockResolvedValue({ uploaded: true });
    getSignedUrlMock.mockResolvedValue('https://signed.example.com/file.txt');
  });

  it('uploads, downloads, deletes, lists, signs, copies, and reads metadata for S3', async () => {
    const storage = new CloudStorageManager('s3', {
      bucket: 'bucket',
      region: 'us-west-2',
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    });

    await expect(storage.uploadFile(Buffer.from('hello'), 'file.txt', {
      contentType: 'text/plain',
      metadata: { owner: 'test' }
    })).resolves.toEqual(expect.objectContaining({
      key: 'file.txt',
      url: 'https://bucket.s3.us-west-2.amazonaws.com/file.txt',
      uploaded: true
    }));
    expect(done).toHaveBeenCalled();

    send.mockResolvedValueOnce({ Body: Buffer.from('hello') });
    await expect(storage.downloadFile('file.txt')).resolves.toEqual(Buffer.from('hello'));

    await expect(storage.deleteFile('file.txt')).resolves.toBe(true);

    send.mockResolvedValueOnce({ Contents: [{ Key: 'file.txt', Size: 5 }] });
    await expect(storage.listFiles('file', { limit: 10 })).resolves.toEqual([{ key: 'file.txt', size: 5 }]);

    await expect(storage.getSignedUrl('file.txt', 60)).resolves.toBe('https://signed.example.com/file.txt');
    await expect(storage.copyFile('file.txt', 'copy.txt')).resolves.toBe(true);

    send.mockResolvedValueOnce({
      ContentLength: 5,
      ContentType: 'text/plain',
      LastModified: new Date('2026-01-01')
    });
    await expect(storage.getFileMetadata('file.txt')).resolves.toEqual({
      size: 5,
      contentType: 'text/plain',
      lastModified: new Date('2026-01-01')
    });
  });

  it('rejects unsupported providers', () => {
    expect(() => new CloudStorageManager('unknown')).toThrow('Unsupported provider');
  });
});
