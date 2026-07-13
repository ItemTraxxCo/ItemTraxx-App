import { callSuperOps } from "./client";
import type { InternalOpsSnapshot } from "./types";

export type { InternalOpsSnapshot } from "./types";

export const getInternalOpsSnapshot = async () =>
  callSuperOps<InternalOpsSnapshot>({
    action: "get_internal_ops_snapshot",
    payload: {},
  });
