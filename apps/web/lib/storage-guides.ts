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
  setupLabel: string;
  setupUrl: string;
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

const r2DashboardUrl = "https://dash.cloudflare.com/?to=/:account/r2/overview";

export const storageProviderGuides = {
  s3: {
    provider: "s3",
    label: "Amazon S3",
    eyebrow: "AWS SETUP GUIDE",
    setupLabel: "注册 AWS 账号",
    setupUrl: "https://signin.aws.amazon.com/signup?request_type=register",
    consoleLabel: "打开 S3 控制台",
    consoleUrl: "https://console.aws.amazon.com/s3/",
    docsLabel: "查看 S3 官方文档",
    docsUrl:
      "https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html",
    fields: [
      {
        key: "endpoint",
        label: "Endpoint",
        description: "填写存储桶所在区域的 HTTPS API 地址，地址中省略存储桶名称。",
        example: "https://s3.ap-southeast-1.amazonaws.com"
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
        description: "可选，可保存 CloudFront 或自定义域名供参考。图床链接在「域名与链接」中配置。",
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
          "连接测试需要目标桶的 s3:ListBucket 权限",
          "当前存储需要 s3:GetObject、s3:PutObject 和 s3:DeleteObject 权限",
          "复制 Access Key ID 与 Secret Access Key，Secret 只显示一次"
        ],
        fieldKeys: ["accessKeyId", "secretAccessKey"]
      },
      {
        title: "填写连接信息",
        description:
          "返回本页填写 Endpoint、区域、存储桶和凭证。Endpoint 与 Region 使用同一个 AWS 区域。",
        checklist: [
          "Region 与创建存储桶时选择的区域完全一致",
          "Bucket 只填写名称，不要填写 s3:// 前缀",
          "AWS S3 通常关闭 Path-style；兼容服务按其文档设置"
        ],
        fieldKeys: ["endpoint", "region", "bucket", "pathStyle"]
      },
      {
        title: "测试连接并复制文件",
        description:
          "点击「测试连接」检查存储桶。点击「设为当前存储」会验证读写与删除权限，然后切换新文件的写入位置。",
        checklist: [
          "确认测试通过后保存配置",
          "旧图保留原有位置，仍可通过原链接访问",
          "图床日常上传和读取仍使用本地存储"
        ],
        fieldKeys: ["bucket"]
      }
    ]
  },
  r2: {
    provider: "r2",
    label: "Cloudflare R2",
    eyebrow: "R2 SETUP GUIDE",
    setupLabel: "开通 Cloudflare R2",
    setupUrl: r2DashboardUrl,
    consoleLabel: "打开 R2 控制台",
    consoleUrl: r2DashboardUrl,
    docsLabel: "查看 R2 官方文档",
    docsUrl: "https://developers.cloudflare.com/r2/api/tokens/",
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
        description: "可选，可保存该桶的自定义域名供参考。图床链接在「域名与链接」中配置。",
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
          "打开 Cloudflare 的 R2 概览页，按页面提示开通 R2，再创建一个专用存储桶。",
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
          "可使用默认的 Path-style。使用桶子域名时，请核对端点和证书"
        ],
        fieldKeys: [
          "endpoint",
          "region",
          "bucket",
          "pathStyle"
        ]
      },
      {
        title: "测试连接并复制文件",
        description:
          "点击「测试连接」检查存储桶。点击「设为当前存储」会验证读写与删除权限，然后切换新文件的写入位置。",
        checklist: [
          "确认测试通过后保存配置",
          "旧图保留原有位置，仍可通过原链接访问",
          "图床日常上传和读取仍使用本地存储"
        ],
        fieldKeys: ["bucket"]
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
