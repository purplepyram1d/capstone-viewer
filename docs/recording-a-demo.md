# Record a Capstone Viewer demo

1. Open Capstone Viewer and choose **Operations**. Pick a public report and close the Feeds settings, private notes, and anything else outside the app window.
2. On Windows 11, press **Win + Shift + R**, drag around the app window, and choose **Start**. Record about 12–18 seconds. Select a state on the map, open a sourced report, and finish on **Live Wall** or **Kiosk**. Turn off mic and system audio for a silent demo.
3. Select **Stop** and save the recording as `capstone-demo.mp4`. The Snipping Tool also saves recordings under **Videos → Screen Recordings** by default. Trim any idle time before publishing. [Microsoft Snipping Tool instructions](https://support.microsoft.com/en-us/windows/apps/use-snipping-tool-to-capture-screenshots)

## Show a looping GIF in the README

With [FFmpeg](https://ffmpeg.org/download.html) installed, put `capstone-demo.mp4` in the repo root and run this from PowerShell.

```powershell
ffmpeg -i capstone-demo.mp4 -t 15 -an -filter_complex "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 docs/demo.gif
```

Replace the screenshot in the README’s **Demo** section with this line, then commit `docs/demo.gif` and `README.md`.

```markdown
![Capstone Viewer demo showing the globe, timeline, and monitoring views](docs/demo.gif)
```

## Link the MP4 from the README

For a longer or higher-resolution demo, keep the screenshot or GIF in the README and add a **Watch the demo** link. Attach the MP4 to a GitHub issue or pull request, copy the attachment URL, then use it as the link target. Use H.264 and keep the upload under 10 MB for a free-plan repository. [GitHub file attachment instructions](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)
