/**
 * Vercel Analytics Agent
 *
 * Fetches analytics data from Vercel API and generates actionable
 * improvement suggestions. Posts results to Slack.
 *
 * Required environment variables:
 *   VERCEL_API_TOKEN   - Vercel API token with read access
 *   VERCEL_PROJECT_ID  - Vercel project ID
 *   VERCEL_TEAM_ID     - Vercel team ID (optional, for team projects)
 *   SLACK_WEBHOOK_URL  - Slack incoming webhook URL
 */

const VERCEL_API_BASE = "https://api.vercel.com";

// Thresholds for Web Vitals (based on Google's Core Web Vitals)
const WEB_VITALS_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 }, // ms
  FID: { good: 100, poor: 300 }, // ms
  CLS: { good: 0.1, poor: 0.25 }, // score
  TTFB: { good: 800, poor: 1800 }, // ms
  FCP: { good: 1800, poor: 3000 }, // ms
  INP: { good: 200, poor: 500 }, // ms
};

// Regression threshold (percentage)
const REGRESSION_THRESHOLD = 0.1; // 10%

async function vercelFetch(endpoint, token, teamId) {
  const url = new URL(`${VERCEL_API_BASE}${endpoint}`);
  if (teamId) url.searchParams.set("teamId", teamId);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchWebVitals(token, projectId, teamId, period = "7d") {
  const endpoint = `/v1/web-analytics/vitals?projectId=${projectId}&period=${period}`;
  return vercelFetch(endpoint, token, teamId);
}

async function fetchPageViews(token, projectId, teamId, period = "7d") {
  const endpoint = `/v1/web-analytics/stats/path?projectId=${projectId}&period=${period}&limit=20`;
  return vercelFetch(endpoint, token, teamId);
}

async function fetchTrafficOverview(token, projectId, teamId, period = "7d") {
  const endpoint = `/v1/web-analytics/stats/overview?projectId=${projectId}&period=${period}`;
  return vercelFetch(endpoint, token, teamId);
}

async function fetchGeoDistribution(token, projectId, teamId, period = "7d") {
  const endpoint = `/v1/web-analytics/stats/country?projectId=${projectId}&period=${period}&limit=10`;
  return vercelFetch(endpoint, token, teamId);
}

async function fetchDeviceBreakdown(token, projectId, teamId, period = "7d") {
  const endpoint = `/v1/web-analytics/stats/device?projectId=${projectId}&period=${period}`;
  return vercelFetch(endpoint, token, teamId);
}

async function fetchPreviousPeriodVitals(token, projectId, teamId) {
  // Fetch previous 7 days for comparison (14d ago to 7d ago)
  const endpoint = `/v1/web-analytics/vitals?projectId=${projectId}&period=14d`;
  return vercelFetch(endpoint, token, teamId);
}

function rateVital(metric, value) {
  const thresholds = WEB_VITALS_THRESHOLDS[metric];
  if (!thresholds) return "unknown";
  if (value <= thresholds.good) return "good";
  if (value <= thresholds.poor) return "needs-improvement";
  return "poor";
}

function vitalEmoji(rating) {
  switch (rating) {
    case "good":
      return "🟢";
    case "needs-improvement":
      return "🟡";
    case "poor":
      return "🔴";
    default:
      return "⚪";
  }
}

function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(num) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function detectRegressions(current, previous) {
  const regressions = [];

  for (const [metric, currentValue] of Object.entries(current)) {
    const prevValue = previous[metric];
    if (prevValue && currentValue > prevValue) {
      const change = (currentValue - prevValue) / prevValue;
      if (change >= REGRESSION_THRESHOLD) {
        regressions.push({
          metric,
          current: currentValue,
          previous: prevValue,
          changePercent: Math.round(change * 100),
        });
      }
    }
  }

  return regressions;
}

function generateSuggestions(vitals, pageViews, regressions) {
  const suggestions = [];

  // Web Vitals suggestions
  if (vitals.LCP) {
    const rating = rateVital("LCP", vitals.LCP);
    if (rating === "poor") {
      suggestions.push({
        priority: "high",
        area: "LCP",
        issue: `Largest Contentful Paint is ${formatMs(vitals.LCP)} (poor)`,
        suggestion:
          "Consider lazy-loading below-fold images, optimizing hero images with next/image, preloading critical assets, or using a CDN for static assets.",
      });
    } else if (rating === "needs-improvement") {
      suggestions.push({
        priority: "medium",
        area: "LCP",
        issue: `Largest Contentful Paint is ${formatMs(vitals.LCP)} (needs improvement)`,
        suggestion:
          "Review largest element on key pages. Consider preconnecting to required origins and optimizing server response times.",
      });
    }
  }

  if (vitals.CLS) {
    const rating = rateVital("CLS", vitals.CLS);
    if (rating !== "good") {
      suggestions.push({
        priority: rating === "poor" ? "high" : "medium",
        area: "CLS",
        issue: `Cumulative Layout Shift is ${vitals.CLS.toFixed(3)} (${rating === "poor" ? "poor" : "needs improvement"})`,
        suggestion:
          "Add explicit width/height to images and embeds. Reserve space for dynamic content. Avoid inserting content above existing content.",
      });
    }
  }

  if (vitals.FID || vitals.INP) {
    const interactivityMetric = vitals.INP || vitals.FID;
    const metricName = vitals.INP ? "INP" : "FID";
    const rating = rateVital(metricName, interactivityMetric);
    if (rating !== "good") {
      suggestions.push({
        priority: rating === "poor" ? "high" : "medium",
        area: metricName,
        issue: `${metricName === "INP" ? "Interaction to Next Paint" : "First Input Delay"} is ${formatMs(interactivityMetric)} (${rating === "poor" ? "poor" : "needs improvement"})`,
        suggestion:
          "Break up long tasks, defer non-critical JavaScript, use web workers for heavy computation, and optimize event handlers.",
      });
    }
  }

  if (vitals.TTFB) {
    const rating = rateVital("TTFB", vitals.TTFB);
    if (rating !== "good") {
      suggestions.push({
        priority: rating === "poor" ? "high" : "medium",
        area: "TTFB",
        issue: `Time to First Byte is ${formatMs(vitals.TTFB)} (${rating === "poor" ? "poor" : "needs improvement"})`,
        suggestion:
          "Review server-side rendering performance, database query efficiency, and edge function cold starts. Consider using edge caching or ISR.",
      });
    }
  }

  // Regression-based suggestions
  for (const reg of regressions) {
    suggestions.push({
      priority: "high",
      area: reg.metric,
      issue: `${reg.metric} regressed by ${reg.changePercent}% (${formatMs(reg.previous)} → ${formatMs(reg.current)})`,
      suggestion: `Investigate recent changes that may have impacted ${reg.metric}. Check for new dependencies, unoptimized images, or increased JavaScript payload.`,
    });
  }

  // Page-specific suggestions
  if (pageViews?.data) {
    const slowPages = pageViews.data.filter(
      (p) => p.vitals?.LCP && p.vitals.LCP > WEB_VITALS_THRESHOLDS.LCP.poor
    );
    for (const page of slowPages.slice(0, 3)) {
      suggestions.push({
        priority: "medium",
        area: "Page Performance",
        issue: `${page.path} has poor LCP (${formatMs(page.vitals.LCP)})`,
        suggestion: `Audit ${page.path} for large images, render-blocking resources, or slow data fetching.`,
      });
    }
  }

  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

function buildSlackMessage(data) {
  const {
    vitals,
    traffic,
    topPages,
    geoData,
    deviceData,
    regressions,
    suggestions,
    period,
  } = data;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📊 Weekly Vercel Analytics Report",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Report period: Last ${period} | Generated: ${new Date().toISOString().split("T")[0]}`,
        },
      ],
    },
    { type: "divider" },
  ];

  // Traffic Overview
  if (traffic) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📈 Traffic Overview*\n• Page Views: *${formatNumber(traffic.pageViews || 0)}*\n• Visitors: *${formatNumber(traffic.visitors || 0)}*\n• Bounce Rate: *${traffic.bounceRate ? `${(traffic.bounceRate * 100).toFixed(1)}%` : "N/A"}*`,
      },
    });
  }

  // Web Vitals
  if (vitals && Object.keys(vitals).length > 0) {
    const vitalsText = Object.entries(vitals)
      .filter(([_, v]) => v != null)
      .map(([metric, value]) => {
        const rating = rateVital(metric, value);
        const emoji = vitalEmoji(rating);
        const formatted = metric === "CLS" ? value.toFixed(3) : formatMs(value);
        return `${emoji} *${metric}*: ${formatted}`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🎯 Core Web Vitals*\n${vitalsText}`,
      },
    });
  }

  // Regressions Alert
  if (regressions.length > 0) {
    const regText = regressions
      .map(
        (r) =>
          `• *${r.metric}*: ↗️ ${r.changePercent}% regression (${formatMs(r.previous)} → ${formatMs(r.current)})`
      )
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Regressions Detected*\n${regText}`,
      },
    });
  }

  // Top Pages
  if (topPages?.data?.length > 0) {
    const pagesText = topPages.data
      .slice(0, 5)
      .map((p, i) => `${i + 1}. \`${p.path}\` — ${formatNumber(p.views)} views`)
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📄 Top Pages*\n${pagesText}`,
      },
    });
  }

  // Geographic Distribution
  if (geoData?.data?.length > 0) {
    const geoText = geoData.data
      .slice(0, 5)
      .map((g) => `• ${g.country}: ${formatNumber(g.views)} views`)
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🌍 Top Countries*\n${geoText}`,
      },
    });
  }

  // Device Breakdown
  if (deviceData?.data) {
    const deviceText = Object.entries(deviceData.data)
      .map(
        ([device, count]) =>
          `• ${device.charAt(0).toUpperCase() + device.slice(1)}: ${formatNumber(count)}`
      )
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📱 Device Breakdown*\n${deviceText}`,
      },
    });
  }

  blocks.push({ type: "divider" });

  // Suggestions
  if (suggestions.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*💡 Improvement Suggestions*",
      },
    });

    const priorityEmoji = { high: "🔴", medium: "🟡", low: "🟢" };

    for (const suggestion of suggestions.slice(0, 5)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${priorityEmoji[suggestion.priority]} *${suggestion.area}*: ${suggestion.issue}\n_${suggestion.suggestion}_`,
        },
      });
    }

    if (suggestions.length > 5) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_+${suggestions.length - 5} more suggestions not shown_`,
          },
        ],
      });
    }
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*✅ All metrics are healthy!* No immediate improvements needed.",
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "View full analytics at <https://vercel.com/dashboard/analytics|Vercel Dashboard>",
      },
    ],
  });

  return { blocks };
}

async function postToSlack(webhookUrl, message) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Slack webhook error ${res.status}: ${text}`);
  }
}

async function main() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID || null;
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  const period = process.env.ANALYTICS_PERIOD || "7d";

  if (!token) {
    console.error("Error: VERCEL_API_TOKEN is required");
    process.exit(1);
  }
  if (!projectId) {
    console.error("Error: VERCEL_PROJECT_ID is required");
    process.exit(1);
  }
  if (!slackWebhookUrl) {
    console.error("Error: SLACK_WEBHOOK_URL is required");
    process.exit(1);
  }

  console.log(`[analytics-agent] Fetching analytics for period: ${period}`);

  try {
    // Fetch all data in parallel
    const [vitalsData, pageViews, traffic, geoData, deviceData, prevVitals] =
      await Promise.all([
        fetchWebVitals(token, projectId, teamId, period).catch((e) => {
          console.warn("[analytics-agent] Could not fetch vitals:", e.message);
          return null;
        }),
        fetchPageViews(token, projectId, teamId, period).catch((e) => {
          console.warn(
            "[analytics-agent] Could not fetch page views:",
            e.message
          );
          return null;
        }),
        fetchTrafficOverview(token, projectId, teamId, period).catch((e) => {
          console.warn("[analytics-agent] Could not fetch traffic:", e.message);
          return null;
        }),
        fetchGeoDistribution(token, projectId, teamId, period).catch((e) => {
          console.warn(
            "[analytics-agent] Could not fetch geo data:",
            e.message
          );
          return null;
        }),
        fetchDeviceBreakdown(token, projectId, teamId, period).catch((e) => {
          console.warn(
            "[analytics-agent] Could not fetch device data:",
            e.message
          );
          return null;
        }),
        fetchPreviousPeriodVitals(token, projectId, teamId).catch((e) => {
          console.warn(
            "[analytics-agent] Could not fetch previous vitals:",
            e.message
          );
          return null;
        }),
      ]);

    // Extract vitals values
    const vitals = vitalsData?.data || {};
    const prevVitalsValues = prevVitals?.data || {};

    // Detect regressions
    const regressions = detectRegressions(vitals, prevVitalsValues);

    // Generate suggestions
    const suggestions = generateSuggestions(vitals, pageViews, regressions);

    console.log(`[analytics-agent] Found ${suggestions.length} suggestions`);
    console.log(`[analytics-agent] Detected ${regressions.length} regressions`);

    // Build and send Slack message
    const slackMessage = buildSlackMessage({
      vitals,
      traffic: traffic?.data,
      topPages: pageViews,
      geoData,
      deviceData,
      regressions,
      suggestions,
      period,
    });

    await postToSlack(slackWebhookUrl, slackMessage);
    console.log("[analytics-agent] Successfully posted report to Slack");

    // Also output summary to console
    console.log("\n--- Analytics Summary ---");
    console.log(`Period: ${period}`);
    console.log(`Vitals:`, vitals);
    console.log(`Regressions: ${regressions.length}`);
    console.log(`Suggestions: ${suggestions.length}`);
  } catch (error) {
    console.error("[analytics-agent] Fatal error:", error);
    process.exit(1);
  }
}

main();
