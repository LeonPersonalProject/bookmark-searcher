# 离线拼音数据

`pinyin.js` 内置完整 Unicode Unihan **17.0.0** `kMandarin` 字表：44,348 个汉字，归并为 419 个无调音节。运行时完全离线，没有第三方运行依赖、网络请求或动态代码执行。

- 来源：<https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip>，其中的 `Unihan_Readings.txt`。
- 数据日期：2025-07-24，版权 © 2025 Unicode, Inc.
- 原始压缩包 SHA-256：`f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e`。
- 许可：Unicode License V3，完整版权和许可条款见随扩展分发的 `UNICODE-LICENSE.txt`。Unicode 的字段说明见 <https://www.unicode.org/reports/tr38/#kMandarin>。

## 数据转换

每条 `kMandarin` 记录采用第一个（主要）读音，转为小写、去除声调，`ü` 统一表示为 `v`，按读音分组保存字符以减小体积。没有丢弃扩展区字符。419 是无调规范化后的音节数量，44,348 是有 `kMandarin` 记录的字符数量，不表示所有 Unicode 汉字都有普通话读音。

维护时先取得上述固定版本的 `Unihan.zip`，在仓库根目录运行：

```sh
python3 scripts/generate-pinyin.py /path/to/Unihan.zip
```

生成脚本只改写 `pinyin.js` 的 `BEGIN GENERATED UNIHAN DATA` 区域，不联网、不需要外部 Python 包。扩展本身不需要运行此脚本。

## 搜索规则与限制

标题和文件夹路径支持连续全拼、全拼前缀、首字母以及中英文混合输入；至少输入两个字母才启用拼音匹配，以免单字母结果过宽。`lv`、`lü`、`lu:` 和带调拼音会归一化到相同拼写。原文精确匹配排序高于拼音匹配。

运行代码中的 `phraseReadings` 是项目维护的常见多音词覆盖表，同时包含相关简繁写法；例如“重庆”“银行”“音乐”“长沙”分别按 `chongqing`、`yinhang`、`yinyue`、`changsha` 匹配，最长词优先。该表是对完整单字字表的读音纠正，不是汉字覆盖的来源。

它不是完整自然语言分词器：人名、地名和依赖上下文的多音词仍可能需要补充词组。不会对所有读音组合做指数展开，也不声称覆盖每个字的所有读音。拼音高亮按命中的原始中文字符范围显示，所有范围均为 UTF-16 半开区间。
