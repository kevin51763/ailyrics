# ailyrics

一个本地音乐播放器。播放任何一首歌时，它都会实时生成跟随歌词和节拍的动态画面。

画面不是 AI 一帧帧画出来的。AI 只做导演：每首歌调用一次 DeepSeek，读歌名和带时间轴的歌词，写出一份分镜脚本，定下配色、换场时刻、每段用什么画面和文字动效。真正画画面的是播放器里的渲染引擎，它按脚本和实时的音频分析逐帧绘制，所以每首歌只花一次 API 调用，播放过程中不用等。

## 运行

需要 Node.js 22.9 或更新的版本，不需要安装依赖。

```sh
cp .env.example .env     # 填入 DEEPSEEK_API_KEY
npm start                # 打开 http://localhost:5173
```

不填 key 也能用，只是没有 AI 设计，每首歌用按歌名生成的默认画面。

## 使用

- 把音乐文件拖进窗口，可以一次拖入多首。同名的 `.lrc` 文件一起拖进来会自动配对。
- 没有歌词时会去 [LRCLIB](https://lrclib.net) 按歌名和歌手查找。歌名和歌手从文件名 `歌手 - 歌名.mp3` 推断，不对的话点"信息"修改。
- 歌一开始播放就有默认画面。AI 脚本到了以后，画面会淡入换成 AI 设计的版本。播放当前这首时，下一首的脚本会提前生成。
- 生成过的脚本缓存在 `cache/scripts/`，同一首歌以后不会再调用 API。不满意可以点"重新生成"。
- 快捷键：空格 播放/暂停，F 全屏，← → 快退/快进 5 秒，N 下一首。

用 `examples/demo.lrc` 可以试歌词效果，把它改成和你的音乐文件同名即可。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 无 | 不设置则只有默认画面 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 想要更好的设计可以换 `deepseek-v4-pro` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 任何兼容 OpenAI 格式的接口都可以。用本地 Ollama 时填 `http://localhost:11434/v1`，`DEEPSEEK_MODEL` 填本地模型名，key 随便填一个 |
| `PORT` | `5173` | |

## 结构

```
server.js              本地服务：静态文件、AI 导演接口、歌词查找、脚本缓存
lib/director.js        给 DeepSeek 的提示词和调用
public/js/script.js    分镜脚本的格式、校验和默认脚本（前后端共用）
public/js/lrc.js       LRC 歌词解析（前后端共用）
public/js/audio.js     实时音频分析：低中高频能量和鼓点
public/js/scenes.js    六个画面模板：particles rings waves grid blocks rain
public/js/engine.js    渲染引擎：场景、转场、镜头、歌词排版
public/js/app.js       播放器界面和队列
```

画面的运动由歌曲时间直接算出，不靠逐帧累加，所以拖动进度条时画面会立即对上。

## 测试

```sh
npm test
```
