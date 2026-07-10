export type StorageGuideProvider = "s3" | "r2";

export type StorageGuideStep = {
  title: string;
  description: string;
  checklist: string[];
};

export type StorageProviderGuide = {
  provider: StorageGuideProvider;
  label: string;
  eyebrow: string;
  consoleLabel: string;
  consoleUrl: string;
  docsLabel: string;
  docsUrl: string;
  steps: StorageGuideStep[];
};

export const storageProviderGuides = {
  s3: {
    provider: "s3",
    label: "Amazon S3",
    eyebrow: "AWS SETUP GUIDE",
    consoleLabel: "打开 S3 控制台",
    consoleUrl: "https://console.aws.amazon.com/s3/",
    docsLabel: "查看 S3 官方文档",
    docsUrl:
      "https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html",
    steps: [
      {
        title: "创建专用存储桶",
        description:
          "在准备部署图片的区域创建一个新存储桶。建议保持“阻止所有公有访问”开启，通过应用或 CDN 提供访问。",
        checklist: [
          "记录创建时选择的 AWS 区域，例如 ap-southeast-1",
          "使用独立、易识别的存储桶名称",
          "不要在存储桶中直接保存应用密钥"
        ]
      },
      {
        title: "创建最小权限凭证",
        description:
          "在 IAM 中创建供 OU-Image Hosting 使用的用户或访问密钥，只授予目标存储桶所需权限。",
        checklist: [
          "允许列出存储桶：s3:ListBucket",
          "允许读写对象：s3:GetObject、s3:PutObject、s3:DeleteObject",
          "复制 Access Key ID 与 Secret Access Key，Secret 只显示一次"
        ]
      },
      {
        title: "填写连接信息",
        description:
          "返回本页填写区域、存储桶和凭证。使用 AWS S3 时 Endpoint 可留空，由服务端按区域解析。",
        checklist: [
          "Region 与创建存储桶时选择的区域完全一致",
          "Bucket 只填写名称，不要填写 s3:// 前缀",
          "AWS S3 通常关闭 Path-style；兼容服务按其文档设置"
        ]
      },
      {
        title: "验证并保存",
        description:
          "先点击“测试连接”，确认可以列出和写入对象，再保存配置。需要公开域名时可填写 CloudFront 或自定义分发域名。",
        checklist: [
          "测试成功后再点击“保存配置”",
          "公开访问地址应使用 HTTPS",
          "上传一张测试图片并确认原图与缩略图均可访问"
        ]
      }
    ]
  },
  r2: {
    provider: "r2",
    label: "Cloudflare R2",
    eyebrow: "R2 SETUP GUIDE",
    consoleLabel: "打开 R2 控制台",
    consoleUrl: "https://dash.cloudflare.com/?to=/:account/r2/overview",
    docsLabel: "查看 R2 官方文档",
    docsUrl: "https://developers.cloudflare.com/r2/api/s3/tokens/",
    steps: [
      {
        title: "创建 R2 存储桶",
        description:
          "在 Cloudflare 控制台进入 R2 Object Storage，创建一个专用于图片的存储桶。",
        checklist: [
          "使用独立、易识别的存储桶名称",
          "创建后记录 Bucket 名称",
          "Region 在 OU-Image Hosting 中保持为 auto"
        ]
      },
      {
        title: "创建 R2 API Token",
        description:
          "在“管理 R2 API 令牌”中创建对象读写令牌，权限范围只选择刚创建的存储桶。",
        checklist: [
          "权限选择 Object Read & Write",
          "资源范围限制为指定存储桶",
          "保存 Access Key ID 与 Secret Access Key，Secret 只显示一次"
        ]
      },
      {
        title: "复制 S3 兼容端点",
        description:
          "从 R2 API 页面复制账户的 S3 Endpoint，然后将凭证与端点填回本页。",
        checklist: [
          "Endpoint 格式为 https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
          "Bucket 填写刚创建的存储桶名称",
          "保持 Path-style 关闭，除非现有兼容配置明确要求开启"
        ]
      },
      {
        title: "配置公开访问并验证",
        description:
          "需要公开图片时，在 R2 存储桶中连接自定义域名；将该 HTTPS 地址填入公开访问域名后测试连接并保存。",
        checklist: [
          "生产环境优先使用自定义域名，不建议依赖开发地址",
          "确认自定义域名状态为 Active",
          "测试连接、保存配置，再上传图片验证访问"
        ]
      }
    ]
  }
} satisfies Record<StorageGuideProvider, StorageProviderGuide>;

export function getStorageProviderGuide(provider: StorageGuideProvider) {
  return storageProviderGuides[provider];
}
