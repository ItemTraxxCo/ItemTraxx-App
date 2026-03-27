import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";
import { edgeFunctionError, missingContextError } from "./appErrors";

export type StudentItem = {
  id: string;
  tenant_id: string;
  username: string;
  student_id: string;
};

export type StudentDetails = {
  checkedOutGear: { id: string; name: string; barcode: string }[];
  lastCheckout: { action_time: string; gear_name: string | null } | null;
  lastReturn: { action_time: string; gear_name: string | null } | null;
};

type MaybeRelation<T> = T | T[] | null;

const pickRelation = <T>(value: MaybeRelation<T>): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const getTenantContextId = () => {
  const tenantId = getAuthState().tenantContextId;
  if (!tenantId) {
    throw missingContextError("Missing tenant context.");
  }
  return tenantId;
};

export const fetchStudents = async () => {
  const tenantId = getTenantContextId();
  return (await authenticatedSelect<StudentItem[]>("students", {
    select: "id,tenant_id,username,student_id",
    tenant_id: `eq.${tenantId}`,
    deleted_at: "is.null",
    order: "created_at.desc",
  })) ?? [];
};

export const fetchDeletedStudents = async () => {
  const result = await invokeEdgeFunction<{ data: StudentItem[] }>(
    "admin-student-mutate",
    {
      method: "POST",
      body: {
        action: "list_deleted",
        payload: {},
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to load archived students.");
  }

  return (result.data?.data ?? []) as StudentItem[];
};

export const createStudent = async (payload: {
  tenant_id: string;
  username?: string;
  student_id?: string;
}) => {
  const result = await invokeEdgeFunction<{ data: StudentItem }>(
    "admin-student-mutate",
    {
      method: "POST",
      body: {
        action: "create",
        payload: {
          tenant_id: payload.tenant_id,
          username: payload.username ?? "",
          student_id: payload.student_id ?? "",
        },
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to create student.");
  }

  return result.data?.data as StudentItem;
};

export const bulkCreateStudents = async (
  rows: Array<{ username?: string; student_id?: string }>
) => {
  const result = await invokeEdgeFunction<{
    data: {
      inserted_count: number;
      skipped_count: number;
      inserted: StudentItem[];
      skipped: Array<{ row: number; reason: string }>;
    };
  }>("admin-student-mutate", {
    method: "POST",
    body: {
      action: "bulk_create",
      payload: { rows },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to import students.");
  }

  return result.data?.data as {
    inserted_count: number;
    skipped_count: number;
    inserted: StudentItem[];
    skipped: Array<{ row: number; reason: string }>;
  };
};

export const deleteStudent = async (id: string) => {
  const result = await invokeEdgeFunction("admin-student-mutate", {
    method: "POST",
    body: {
      action: "delete",
      payload: { id },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to remove student.");
  }
};

export const restoreStudent = async (id: string) => {
  const result = await invokeEdgeFunction<{ data: StudentItem }>(
    "admin-student-mutate",
    {
      method: "POST",
      body: {
        action: "restore",
        payload: { id },
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to restore student.");
  }

  return result.data?.data as StudentItem;
};

export const fetchStudentDetails = async (studentUuid: string) => {
  const tenantId = getTenantContextId();
  const checkedOutGear = await authenticatedSelect<Array<{ id: string; name: string; barcode: string }>>("gear", {
    select: "id,name,barcode",
    tenant_id: `eq.${tenantId}`,
    deleted_at: "is.null",
    checked_out_by: `eq.${studentUuid}`,
  });

  const lastCheckoutData = await authenticatedSelect<Array<{ action_time: string; gear: { name: string }[] | { name: string } | null }>>("gear_logs", {
    select: "action_time,gear:gear_id(name)",
    tenant_id: `eq.${tenantId}`,
    checked_out_by: `eq.${studentUuid}`,
    action_type: "eq.checkout",
    order: "action_time.desc",
    limit: "1",
  });

  const lastReturnData = await authenticatedSelect<Array<{ action_time: string; gear: { name: string }[] | { name: string } | null }>>("gear_logs", {
    select: "action_time,gear:gear_id(name)",
    tenant_id: `eq.${tenantId}`,
    checked_out_by: `eq.${studentUuid}`,
    action_type: "eq.return",
    order: "action_time.desc",
    limit: "1",
  });

  const checkoutRow = (lastCheckoutData?.[0] ?? null) as
    | { action_time: string; gear: MaybeRelation<{ name: string }> }
    | null;
  const lastCheckout = checkoutRow
    ? {
        action_time: checkoutRow.action_time,
        gear_name: pickRelation(checkoutRow.gear)?.name ?? null,
      }
    : null;

  const returnRow = (lastReturnData?.[0] ?? null) as
    | { action_time: string; gear: MaybeRelation<{ name: string }> }
    | null;
  const lastReturn = returnRow
    ? {
        action_time: returnRow.action_time,
        gear_name: pickRelation(returnRow.gear)?.name ?? null,
      }
    : null;

  return {
    checkedOutGear: (checkedOutGear ?? []) as {
      id: string;
      name: string;
      barcode: string;
    }[],
    lastCheckout,
    lastReturn,
  } as StudentDetails;
};
