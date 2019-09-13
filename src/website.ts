import * as AWS from "aws-sdk";
import * as mimeTypes from "mime-types";
import * as zlib from "zlib";
import * as crypto from "crypto";

export interface IErrorHandler {
    (message: string, err: object): void;
}

export class Website {
    private static readonly GZIP_MIME_TYPES = new Set([
        "text/plain",
        "text/html",
        "text/css",
        "application/javascript",
        "application/json"
    ]);

    private s3: AWS.S3;

    constructor(private bucketName: string, private keyPrefix: string, private onError: IErrorHandler) {
        this.s3 = new AWS.S3({ apiVersion: '2006-03-01' });
    }

    uploadFileFromStream(fileName: string, stream: any) {
        var data: any[] = [];

        stream
            .on("data", (chunk: string) => {
                data.push(chunk);
            })
            .on("end", async () => {
                let params : AWS.S3.PutObjectRequest = {
                    Bucket: this.bucketName,
                    Key: fileName,
                    ACL: "public-read"
                };
                const contentType = mimeTypes.lookup(fileName);
                if (contentType) {
                    params.ContentType = contentType;
                }

                const body = Buffer.concat(data);

                if (Website.GZIP_MIME_TYPES.has(contentType)) {
                    params.Body = zlib.gzipSync(body);
                    params.ContentEncoding = "gzip";
                } else {
                    params.Body = body;
                }

                const previousObjectMeta = await this.s3.headObject({Bucket: this.bucketName, Key: fileName}).promise();

                const currentHash = previousObjectMeta.ETag ? crypto.createHash('md5').update(params.Body as Buffer).digest('hex') : "";

                if (!previousObjectMeta.ETag || previousObjectMeta.ETag !== `"${currentHash}"`) {
                    this.s3.putObject(params, (err: object) => {
                        if(err){
                            this.onError("Error uploading file to s3 bucket", err);
                        }
                    });
                }
            });
    }

    async removeDifferences(keepFiles: string[]) : Promise<AWS.S3.Error[]> {
        let existingFiles = await this.getAWSBucketListing();

        let filesToRemove = existingFiles.filter((item) => { return ! (keepFiles.indexOf(item) > -1); });

        if (filesToRemove.length !== 0) {
            console.log("Deleting old files: " + JSON.stringify(filesToRemove));
            let params = {
                Bucket: this.bucketName,
                Delete: {
                    Objects: filesToRemove.map((item) => ({ Key: item }))
                }
            };
            let result = await this.s3.deleteObjects(params).promise();
            return result.Errors || [];
        }
        return [];
    }

    private async getAWSBucketListing(): Promise<string[]> {
        let params: any = { Bucket: this.bucketName, Prefix: this.keyPrefix };
        let files: string[] = [];
        let keepGoing = true;

        while (keepGoing) {
            let response = await this.s3.listObjectsV2(params).promise();
            
            (response.Contents || [])
                .map((item) => { return item.Key || ""; })
                .forEach((item) => { files.push(item); });

            if (response.IsTruncated) {
                params.ContinuationToken = response.NextContinuationToken;
            } else {
                keepGoing = false;
            }
        }

        return files;
    }
}