export const STATUS_PAGE_URL = "https://status.itemtraxx.com";

export const splitStatusPageMessage = (message: string) =>
  message
    .split(/(status page)/gi)
    .filter(Boolean)
    .map((text) => ({
      text,
      isLink: text.toLowerCase() === "status page",
    }));
