export type ProductEventProperties = Record<string, string | number | boolean>;

export type ProductEventDelivery = {
  name: string;
  properties?: ProductEventProperties;
};

export type ProductEventDeliveries = {
  analytics?: ProductEventDelivery;
  posthog?: ProductEventDelivery;
};

export const trackProductEvent = ({ analytics, posthog }: ProductEventDeliveries): void => {
  if (analytics) {
    void import("./analyticsService")
      .then(({ trackAnalyticsEvent }) =>
        trackAnalyticsEvent(analytics.name, analytics.properties),
      )
      .catch(() => undefined);
  }

  if (posthog) {
    void import("./posthogService")
      .then(({ capturePostHogEvent }) =>
        capturePostHogEvent(posthog.name, posthog.properties),
      )
      .catch(() => undefined);
  }
};
