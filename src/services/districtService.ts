import { clearDistrictState, setDistrictState } from "../store/districtState";
import { supabase } from "./supabaseClient";

export const DISTRICT_HOST_ROOT = "app.itemtraxx.com";
const RESERVED_SUBDOMAINS = new Set(["www", "internal", "status", "app"]);
const ROOT_HOSTS = new Set(["itemtraxx.com", "www.itemtraxx.com", DISTRICT_HOST_ROOT]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export type ResolvedDistrictHost = {
  host: string;
  slug: string | null;
  isDistrictHost: boolean;
  baseHost: string | null;
};

type DistrictLookupRow = {
  id: string;
  name: string;
  slug?: string | null;
  is_active?: boolean | null;
};

export const resolveDistrictHost = (
  hostname = typeof window !== "undefined" ? window.location.hostname : ""
): ResolvedDistrictHost => {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return {
      host: "",
      slug: null,
      isDistrictHost: false,
      baseHost: null,
    };
  }

  if (ROOT_HOSTS.has(host) || LOCAL_HOSTS.has(host)) {
    return {
      host,
      slug: null,
      isDistrictHost: false,
      baseHost: host,
    };
  }

  if (host.endsWith(`.${DISTRICT_HOST_ROOT}`)) {
    const subdomain = host.slice(0, -(`.${DISTRICT_HOST_ROOT}`).length);
    const normalized = normalizeSlug(subdomain);
    const isDistrictHost = !!normalized && !RESERVED_SUBDOMAINS.has(normalized);
    return {
      host,
      slug: isDistrictHost ? normalized : null,
      isDistrictHost,
      baseHost: DISTRICT_HOST_ROOT,
    };
  }

  if (host.endsWith(".localhost")) {
    const subdomain = host.slice(0, -".localhost".length);
    const normalized = normalizeSlug(subdomain);
    const isDistrictHost = !!normalized && !RESERVED_SUBDOMAINS.has(normalized);
    return {
      host,
      slug: isDistrictHost ? normalized : null,
      isDistrictHost,
      baseHost: "localhost",
    };
  }

  return {
    host,
    slug: null,
    isDistrictHost: false,
    baseHost: host,
  };
};

const lookupDistrictBySlug = async (slug: string) => {
  const { data, error } = await supabase.rpc("resolve_public_district_by_slug", {
    input_slug: slug,
  });

  if (error) {
    return null;
  }

  const district = Array.isArray(data) ? (data[0] as DistrictLookupRow | undefined) : null;
  if (!district?.id || district.is_active === false) {
    return null;
  }

  return district;
};

export const lookupDistrictById = async (districtId: string) => {
  const { data, error } = await supabase.rpc("resolve_public_district_by_id", {
    input_id: districtId,
  });

  if (error) {
    return null;
  }

  const district = Array.isArray(data) ? (data[0] as DistrictLookupRow | undefined) : null;
  if (!district?.id || district.is_active === false) {
    return null;
  }

  return district;
};

export const buildDistrictAppUrl = (slug: string, path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${slug}.${DISTRICT_HOST_ROOT}${normalizedPath}`;
};

export const buildDistrictAppHandoffUrl = (
  slug: string,
  path: string,
  accessToken: string,
  refreshToken: string
) => {
  const url = new URL(buildDistrictAppUrl(slug, path));
  url.hash = new URLSearchParams({
    itx_at: accessToken,
    itx_rt: refreshToken,
  }).toString();
  return url.toString();
};

export const initializeDistrictContext = async () => {
  if (typeof window === "undefined") return;
  const resolved = resolveDistrictHost(window.location.hostname);
  if (!resolved.host) {
    clearDistrictState();
    return;
  }
  setDistrictState(resolved);
  setDistrictState({
    districtId: null,
    districtName: null,
    isKnownDistrict: false,
  });
  if (resolved.slug) {
    document.documentElement.dataset.districtSlug = resolved.slug;
    const district = await lookupDistrictBySlug(resolved.slug);
    setDistrictState({
      districtId: district?.id ?? null,
      districtName: district?.name ?? null,
      isKnownDistrict: !!district?.id,
    });
  } else {
    delete document.documentElement.dataset.districtSlug;
  }
};
