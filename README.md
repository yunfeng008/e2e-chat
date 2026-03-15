# SafeChat — 端对端加密即时通讯

面向个人/朋友的开源 E2E 加密 IM，无需手机号或邮箱。

## 安全架构

```
Alice Device                Signal Server               Bob Device
    │                           │                           │
    │  register(userId, pubkeys)│                           │
    │──────────────────────────>│                           │
    │                           │  register(userId, pubkeys)│
    │                           │<──────────────────────────│
    │                           │                           │
    │  fetch_prekey_bundle(Bob) │                           │
    │──────────────────────────>│                           │
    │<── Bob's public keys only ─│                           │
    │                           │                           │
    │  X3DH locally (no server) │                           │
    │  ┌─────────────────────┐  │                           │
    │  │ masterSecret = KDF( │  │                           │
    │  │  DH(IK_a, SPK_b)    │  │                           │
    │  │  DH(EK_a, IK_b)     │  │                           │
    │  │  DH(EK_a, SPK_b)    │  │                           │
    │  └─────────────────────┘  │                           │
    │                           │                           │
    │  send(Bob, encryptedMsg)  │                           │
    │──────────────────────────>│  relay(encryptedMsg)      │
    │                           │──────────────────────────>│
    │                           │   (server sees only bytes)│
    │                           │                           │
    │         Double Ratchet: every message gets a new key  │
```

**服务器零知识**：服务器只做 WebSocket 消息转发，从不存储消息，无法解密任何内容。

## 加密协议栈

| 层 | 算法 | 用途 |
|---|---|---|
| 身份密钥 | X25519 + Ed25519 | 长期身份与签名 |
| 密钥协商 | X3DH | 初始会话建立 |
| 消息加密 | Double Ratchet | 每消息前向安全 |
| 对称加密 | AES-256-GCM (via libsodium) | 消息密文 |
| 本地存储 | AES-256-GCM | IndexedDB 加密 |
| 文件传输 | WebRTC DataChannel (加密) | P2P 直连 |

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（同时启动信令服务器和前端）
npm run dev

# 前端: http://localhost:5173
# 信令服务器: http://localhost:3001
```

## 部署

```bash
# 构建前端
npm run build

# 生产运行信令服务器
PORT=3001 node server/index.js
```

## 项目结构

```
safechat/
├── server/
│   └── index.js          # 信令服务器（零知识中继）
└── src/
    ├── crypto/
    │   ├── engine.ts     # X3DH + Double Ratchet 加密核心
    │   ├── storage.ts    # IndexedDB 加密本地存储
    │   └── network.ts    # Socket.io + WebRTC 网络层
    ├── store/
    │   └── index.ts      # Zustand 全局状态 + 业务逻辑
    └── components/
        ├── Onboarding.tsx     # 匿名身份创建
        ├── ChatShell.tsx      # 主界面框架
        ├── ConversationList.tsx
        ├── ChatPanel.tsx      # 消息线程 + 输入
        ├── ProfilePanel.tsx   # 身份 + 二维码
        └── AddContactModal.tsx # 扫码/手动添加联系人
```

## 隐私保证

- **无账号注册**：只需输入昵称，本地生成密钥对
- **无服务器消息存储**：方案 A（纯在线 P2P），离线时消息丢弃
- **服务器零知识**：服务器只见加密后的字节流
- **阅后即焚**：消息 TTL 5秒 ~ 24小时可选
- **本地加密存储**：IndexedDB 数据用身份密钥加密

## 已知限制（MVP）

- 双方需同时在线才能收发消息（纯 P2P 方案 A）
- 暂不支持多设备同步
- 群聊尚未实现（P2 阶段）
- 无推送通知（需要开着浏览器）
