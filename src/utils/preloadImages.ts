const preloadedImages = new Map<string, HTMLImageElement>();

export const preloadImages = (urls: readonly (string | undefined | null)[]) => {
  if (typeof Image === "undefined") return;

  const uniqueUrls = new Set(urls.filter((candidate): candidate is string => Boolean(candidate)));
  for (const url of uniqueUrls) {
    if (preloadedImages.has(url)) continue;

    const image = new Image();
    preloadedImages.set(url, image);
    image.decoding = "async";
    image.onerror = () => preloadedImages.delete(url);
    image.src = url;
  }
};
