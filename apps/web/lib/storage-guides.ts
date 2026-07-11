export type StorageGuideProvider = "s3" | "r2";

export type StorageGuideStep = {
  title: string;
  description: string;
  checklist: string[];
  fieldKeys?: StorageGuideFieldKey[];
};

export type StorageGuideFieldKey =
  | "endpoint"
  | "region"
  | "bucket"
  | "accessKeyId"
  | "secretAccessKey"
  | "publicBaseUrl"
  | "pathStyle";

export type StorageGuideField = {
  key: StorageGuideFieldKey;
  label: string;
  description: string;
  example: string;
};

export type StorageProviderGuide = {
  provider: StorageGuideProvider;
  label: string;
  eyebrow: string;
  consoleLabel: string;
  consoleUrl: string;
  docsLabel: string;
  docsUrl: string;
  fields: StorageGuideField[];
  steps: StorageGuideStep[];
};

export type StorageConnectionError = {
  title: string;
  description: string;
  suggestions: string[];
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
    fields: [
      {
        key: "endpoint",
        label: "Endpoint",
        description: "AWS S3 可留空；仅在使用 S3 兼容服务时填写其 HTTPS API 地址。",
        example: "留空，或 https://s3.example.com"
      },
      {
        key: "region",
        label: "Region",
        description: "存储桶所在的 AWS 区域代码，必须与创建时的区域完全一致。",
        example: "ap-southeast-1"
      },
      {
        key: "bucket",
        label: "Bucket",
        description: "只填写存储桶名称，不要包含 s3://、域名或目录路径。",
        example: "ou-image-assets"
      },
      {
        key: "accessKeyId",
        label: "Access Key ID",
        description: "IAM 访问密钥的公开标识，不是 AWS 账号 ID。",
        example: "AKIA..."
      },
      {
        key: "secretAccessKey",
        label: "Secret Access Key",
        description: "与 Access Key 配套的密钥，只在保存或测试时发送且不会回显。",
        example: "创建访问密钥时一次性复制"
      },
      {
        key: "publicBaseUrl",
        label: "Public Base URL",
        description: "可选的 CloudFront 或公开自定义域名，用于生成图片访问链接。",
        example: "https://img.example.com"
      },
      {
        key: "pathStyle",
        label: "Path-style",
        description: "AWS S3 通常关闭；MinIO 等兼容服务可能要求开启。",
        example: "AWS S3：关闭"
      }
    ],
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
        ],
        fieldKeys: ["accessKeyId", "secretAccessKey"]
      },
      {
        title: "填写连接信息",
        description:
          "返回本页填写区域、存储桶和凭证。使用 AWS S3 时 Endpoint 可留空，由服务端按区域解析。",
        checklist: [
          "Region 与创建存储桶时选择的区域完全一致",
          "Bucket 只填写名称，不要填写 s3:// 前缀",
          "AWS S3 通常关闭 Path-style；兼容服务按其文档设置"
        ],
        fieldKeys: ["endpoint", "region", "bucket", "pathStyle"]
      },
      {
        title: "验证并保存",
        description:
          "先点击“测试连接”，确认可以列出和写入对象，再保存配置。需要公开域名时可填写 CloudFront 或自定义分发域名。",
        checklist: [
          "测试成功后再点击“保存配置”",
          "公开访问地址应使用 HTTPS",
          "上传一张测试图片并确认原图与缩略图均可访问"
        ],
        fieldKeys: ["publicBaseUrl"]
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
    fields: [
      {
        key: "endpoint",
        label: "Endpoint",
        description: "R2 概览页提供的账户级 S3 API 地址，包含 Cloudflare Account ID。",
        example: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
      },
      {
        key: "region",
        label: "Region",
        description: "R2 的 S3 兼容区域固定填写 auto。",
        example: "auto"
      },
      {
        key: "bucket",
        label: "Bucket",
        description: "R2 存储桶名称，不要填写域名或 Endpoint。",
        example: "ou-image-assets"
      },
      {
        key: "accessKeyId",
        label: "Access Key ID",
        description: "创建 R2 API 令牌后显示的 S3 访问密钥 ID。",
        example: "令牌创建结果中的 Access Key ID"
      },
      {
        key: "secretAccessKey",
        label: "Secret Access Key",
        description: "令牌创建结果中的 S3 Secret，只显示一次且不会由本站回显。",
        example: "创建令牌时一次性复制"
      },
      {
        key: "publicBaseUrl",
        label: "Public Base URL",
        description: "绑定到该桶的公开自定义域名，不是 R2 S3 API Endpoint。",
        example: "https://img.example.com"
      },
      {
        key: "pathStyle",
        label: "Path-style",
        description: "R2 通常关闭；仅在既有兼容配置明确要求时开启。",
        example: "关闭"
      }
    ],
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
        ],
        fieldKeys: ["accessKeyId", "secretAccessKey"]
      },
      {
        title: "复制 S3 兼容端点",
        description:
          "从 R2 API 页面复制账户的 S3 Endpoint，然后将凭证与端点填回本页。",
        checklist: [
          "Endpoint 格式为 https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
          "Bucket 填写刚创建的存储桶名称",
          "保持 Path-style 关闭，除非现有兼容配置明确要求开启"
        ],
        fieldKeys: [
          "endpoint",
          "region",
          "bucket",
          "pathStyle"
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
        ],
        fieldKeys: ["publicBaseUrl"]
      }
    ]
  }
} satisfies Record<StorageGuideProvider, StorageProviderGuide>;

export function getStorageProviderGuide(
  provider: StorageGuideProvider
): StorageProviderGuide {
  return storageProviderGuides[provider];
}

export function explainStorageConnectionError(
  message: string,
  provider: StorageGuideProvider
): StorageConnectionError {
  const normalized = message.toLowerCase();

  if (/accessdenied|access denied|forbidden|403|not authorized/.test(normalized)) {
    return {
      title: "凭证没有所需权限",
      description: "提供商拒绝了当前访问密钥的操作请求。",
      suggestions: [
        provider === "r2"
          ? "确认 R2 API 令牌包含 Object Read & Write 权限"
          : "确认 IAM 策略包含 ListBucket、GetObject、PutObject 和 DeleteObject",
        "确认令牌或 IAM 策略限制的存储桶与当前 Bucket 一致",
        "更新权限后重新测试，无需重新创建存储桶"
      ]
    };
  }

  if (/invalidaccesskeyid|signaturedoesnotmatch|signature|credential|secret|401/.test(normalized)) {
    return {
      title: "访问密钥不匹配",
      description: "Access Key ID、Secret Access Key 或签名参数无法通过验证。",
      suggestions: [
        "重新复制 Access Key ID，避免包含前后空格",
        "重新填写与该 Access Key 配套的 Secret Access Key",
        provider === "r2"
          ? "确认使用的是 R2 API 令牌凭证，而不是 Cloudflare Global API Key"
          : "确认密钥尚未在 IAM 中停用或删除"
      ]
    };
  }

  if (/nosuchbucket|bucket.*not.*exist|notfound|not found|404/.test(normalized)) {
    return {
      title: "找不到存储桶",
      description: "当前账号或 Endpoint 下不存在填写的 Bucket。",
      suggestions: [
        "Bucket 只填写名称，不要包含 s3://、域名或目录",
        "检查大小写和拼写，并确认凭证属于创建该桶的账号",
        provider === "r2"
          ? "确认 Endpoint 中的 Account ID 与该 R2 存储桶所属账号一致"
          : "确认 Region 与存储桶实际区域一致"
      ]
    };
  }

  if (/region|redirect|301|authorizationheadermalformed/.test(normalized)) {
    return {
      title: "区域设置不一致",
      description: "请求被发送到了与存储桶实际区域不同的 Endpoint。",
      suggestions: [
        provider === "r2" ? "R2 的 Region 固定填写 auto" : "复制 S3 控制台显示的区域代码",
        "不要把可用区名称或中文区域名称填入 Region",
        "保存修改后重新执行连接测试"
      ]
    };
  }

  if (/timeout|timed out|etimedout|network|fetch failed|econn|enotfound|dns|certificate|tls/.test(normalized)) {
    return {
      title: "无法连接到存储服务",
      description: "服务器未能在有效时间内建立到对象存储的安全连接。",
      suggestions: [
        "确认 Endpoint 是完整、可访问的 HTTPS 地址",
        "检查服务器 DNS、出站网络和防火墙设置",
        "使用自签名证书的兼容服务需要先配置受信任证书"
      ]
    };
  }

  return {
    title: "连接测试未通过",
    description: message || "提供商没有返回可识别的错误信息。",
    suggestions: [
      "依次核对 Endpoint、Region、Bucket 和两项访问密钥",
      "确认存储桶存在，并且凭证拥有对象读写和列出权限",
      "仍无法连接时，查看服务端日志中的提供商错误代码"
    ]
  };
}
