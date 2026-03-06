import { reactive } from "vue";

export type DistrictState = {
  host: string | null;
  slug: string | null;
  isDistrictHost: boolean;
  baseHost: string | null;
  districtId: string | null;
  districtName: string | null;
  isKnownDistrict: boolean;
};

const defaultState: DistrictState = {
  host: null,
  slug: null,
  isDistrictHost: false,
  baseHost: null,
  districtId: null,
  districtName: null,
  isKnownDistrict: false,
};

const districtState = reactive<DistrictState>({ ...defaultState });

export const getDistrictState = () => districtState;

export const setDistrictState = (next: Partial<DistrictState>) => {
  Object.assign(districtState, next);
};

export const clearDistrictState = () => {
  Object.assign(districtState, defaultState);
};
