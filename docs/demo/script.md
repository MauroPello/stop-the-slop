### [0:00 – 0:45] Intro & Problem

*[Show Stop the Slop website]*

Hi everyone, I’m Mauro Pellonara. I’m a second-year Master’s student in Data Science at EPFL, and I’m currently interning at Logitech as a Machine Learning Research Intern.

Like most people, I spend a lot of time on YouTube. But lately, there’s been a lot more low-quality AI-generated content, more specifically videos that sound interesting but don’t really say anything.

So I built a small side project to help with that: it's called **Stop the Slop**, it's an open-source extension that detects AI-generated videos on YouTube.

### [0:45 – 1:45] Product Demo

*[Show YouTube feed]*

Here, you can already see badges on some of the thumbnails. You won’t see one on every video, because I don’t analyze the whole feed in advance.

A video gets analyzed when someone actually opens it.

*[Open a video]*

So when I open this one, the extension automatically grabs the transcript and checks it in the background.

Then I can see the result directly inside the YouTube player, or by opening the extension.

And once a video has been analyzed once, I save the result. So if someone else comes across the same video later, they can see the badge immediately on the thumbnail without analyzing it again.

That keeps the extension fast and avoids doing unnecessary work.

### [1:45 – 3:40] Keeping the Cost at Zero

*[Show Cloudflare tab]*

That also connects to one of the main goals of the project: I wanted to see if I could run the whole thing for basically no money.

And right now, the monthly cost is ~**zero dollars**.

This is because the backend runs on Cloudflare’s free tier, and I use their free SQLite database to save the results.

The website is also hosted for free on GitHub, so I don’t pay for a custom domain that I don't need anyway since Stop the Slop is just an extension.

The last piece was choosing the AI detector.

There are already quite a few options. I could use a general-purpose model like Gemini, an online AI detector service, or an open-source one.

Instead of just choosing one, I ran a benchmark.

*[Show benchmark figure]*

I tested several detectors on **1,000 YouTube videos: 500 human-written and 500 AI-generated**.

I compared Jev, Gemini, WasItAiGenerated.com, and a popular open-source detector called RADAR.

*[Show Jev announcement X post]*

In case you don't know, Jev is a new model from TypeSafe AI built for exactly this kind of task: making fast decisions instead of generating text.

And it performed best in my benchmark, with about **91% F1**, compared with 75% for RADAR, 64% for WasItAiGenerated.com, and 61% for Gemini.

It’s also extremely cheap — about **4 cents per million input tokens** — which made it the perfect fit for this project.

### [3:40 – 4:15] Dealing With Uncertainty

*[Back to benchmark figure or YouTube home feed]*

Of course, AI detection isn’t perfect and that's why companies like Anthropic are now watermarking the output of their models.

The issue is that some people write very polished and structured scripts, which can look surprisingly similar to AI-generated text.

So for this reason the extension shows the likelihood of the video being AI-generated instead of a simple yes-or-no answer.

### [4:15 – 5:00] Conclusion

*[Show GitHub repo]*

So to wrap it up, the interesting part for me wasn’t just building an AI detector. It was figuring out how to turn it into something 300+ people actually use without it costing a lot.

And right now, the whole thing costs essentially **zero dollars to run**.

More broadly, I hope this inspires some of you to think about cheaper ways of deploying AI and software. AI has made it much easier and faster to build things, and I think it’s just as important to make them cheap enough to actually put out into the world.

In my opinion, you shouldn’t need a huge budget to ship an idea and see if people use it.

Thanks for listening, and I’d be happy to take any questions.