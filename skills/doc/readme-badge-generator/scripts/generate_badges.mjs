const repo = process.argv[2] || "modelcontextprotocol/servers";
const license = process.argv[3] || "MIT";
const lang = process.argv[4] || "TypeScript";

console.log(`# 徽章 Markdown 代码：

<div align="center">

![Language](https://img.shields.io/badge/Language-${encodeURIComponent(lang)}-blue.svg)
![License](https://img.shields.io/badge/License-${encodeURIComponent(license)}-green.svg)
![GitHub Stars](https://img.shields.io/github/stars/${repo}?style=social)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

</div>
`);
