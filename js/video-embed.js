// video-embed.js
// Shared click-to-load player for YouTube / Vimeo, used by both the list
// preview pane and the reader pane so playback behaves identically.

function embedSrc(video) {
  if (video.provider === "tiktok") return `https://www.tiktok.com/player/v1/${video.id}?music_info=1&description=1`;
  return video.provider === "vimeo"
    ? `https://player.vimeo.com/video/${video.id}?dnt=1&autoplay=1`
    : `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1`;
}

function watchUrl(video) {
  if (video.provider === "vimeo") return `https://vimeo.com/${video.id}`;
  if (video.provider === "tiktok") return `https://www.tiktok.com/@${video.user || ""}/video/${video.id}`;
  if (video.short) return `https://www.youtube.com/shorts/${video.id}`;
  return `https://www.youtube.com/watch?v=${video.id}`;
}

function playLabel(video) {
  if (video.provider === "vimeo") return "\u25b6 Play Vimeo video";
  if (video.provider === "tiktok") return "\u25b6 Play TikTok video";
  return video.short ? "\u25b6 Play YouTube Short" : "\u25b6 Play YouTube video";
}

function watchLabel(video) {
  if (video.provider === "vimeo") return "Watch on Vimeo \u2197";
  if (video.provider === "tiktok") return "Watch on TikTok \u2197";
  return "Watch on YouTube \u2197";
}

export function buildVideoEmbed(video, prefix) {
  const holder = document.createElement("div");
  holder.className = `${prefix}__video`;
  if (video.short) holder.dataset.short = "true";

  const play = document.createElement("button");
  play.type = "button";
  play.className = `${prefix}__videoPlay`;
  play.textContent = playLabel(video);

  play.addEventListener("click", (e) => {
    e.stopPropagation();
    const iframe = document.createElement("iframe");
    iframe.className = `${prefix}__videoFrame`;
    iframe.src = embedSrc(video);
    iframe.allow = "encrypted-media; picture-in-picture; fullscreen";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.loading = "lazy";
    iframe.title = "Embedded video";
    iframe.allowFullscreen = true;

    const close = document.createElement("button");
    close.type = "button";
    close.className = `${prefix}__videoClose`;
    close.setAttribute("aria-label", "Close video");
    close.textContent = "\u2715";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      holder.replaceChildren(play);
      play.focus();
    });

    holder.replaceChildren(iframe, close);
    close.focus();
  });

  holder.appendChild(play);

  const fallback = document.createElement("a");
  fallback.className = `${prefix}__videoFallback`;
  fallback.href = watchUrl(video);
  fallback.target = "_blank";
  fallback.rel = "noopener noreferrer";
  fallback.textContent = watchLabel(video);

  return { holder, fallback };
}

const IMAGE_URL = /\.(?:apng|avif|gif|jpe?g|png|webp|bmp|svg)(?:[?#].*)?$/i;

export function looksLikeImage(url) {
  return typeof url === "string" && IMAGE_URL.test(url);
}

export function detectVideo(s) {
  if (!s) return null;
  const short = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (short) return { provider: "youtube", id: short[1], short: true };
  const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { provider: "youtube", id: yt[1] };
  const vm = s.match(/(?:vimeo\.com\/(?:video\/)?)(\d{6,})/);
  if (vm) return { provider: "vimeo", id: vm[1] };
  const tt = s.match(/tiktok\.com\/@([\w.-]+)\/video\/(\d{6,})/i);
  if (tt) return { provider: "tiktok", id: tt[2], user: tt[1] };
  const tte = s.match(/tiktok\.com\/(?:player\/v1|embed(?:\/v2)?)\/(\d{6,})/i);
  if (tte) return { provider: "tiktok", id: tte[1] };
  const ttm = s.match(/m\.tiktok\.com\/v\/(\d{6,})/i);
  if (ttm) return { provider: "tiktok", id: ttm[1] };
  return null;
}
