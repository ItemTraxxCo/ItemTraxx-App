import { optionalPostgrestSearchText } from "../../_shared/postgrestSearch.ts";
import {
  optionalInteger,
  optionalText,
  requireUuid,
} from "../../_shared/validation.ts";
import type { SupabaseAdminClient, SuperOpsContext } from "../context.ts";

export const SUPPORT_ACTIONS = [
  "list_support_requests",
  "get_support_request",
  "update_support_request",
] as const;

type SupportRequestStatus = "open" | "in_progress" | "resolved" | "spam";

const SUPPORT_ATTACHMENT_BUCKET = "support-request-attachments";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SUPPORT_ATTACHMENT_EXTENSION_PATTERN = /^(png|jpg|webp|gif)$/i;

type SupportAttachmentRecord = {
  id: string;
  original_filename: string | null;
  stored_filename: string;
  content_type: string;
  size_bytes: number;
  storage_bucket: string | null;
  storage_path: string | null;
};

type SafeSupportAttachmentPathParts = {
  requestIdSegment: string;
  fileIdSegment: string;
  extensionSegment: string;
};

const getSafeSupportAttachmentPathParts = (attachment: {
  storage_bucket: string | null;
  storage_path: string | null;
}): SafeSupportAttachmentPathParts | null => {
  if (attachment.storage_bucket !== SUPPORT_ATTACHMENT_BUCKET) {
    return null;
  }
  if (typeof attachment.storage_path !== "string") {
    return null;
  }
  if (
    attachment.storage_path.includes("../") ||
    attachment.storage_path.includes("..\\") ||
    attachment.storage_path.startsWith("/") ||
    attachment.storage_path.startsWith("\\")
  ) {
    return null;
  }
  const normalizedPath = attachment.storage_path.trim();
  const pathSegments = normalizedPath.split("/");
  if (pathSegments.length !== 2) {
    return null;
  }

  const [requestIdSegment, fileNameSegment] = pathSegments;
  if (!UUID_PATTERN.test(requestIdSegment)) {
    return null;
  }

  const fileNameSegments = fileNameSegment.split(".");
  if (fileNameSegments.length !== 2) {
    return null;
  }

  const [fileIdSegment, extensionSegment] = fileNameSegments;
  if (
    !UUID_PATTERN.test(fileIdSegment) ||
    !SAFE_SUPPORT_ATTACHMENT_EXTENSION_PATTERN.test(extensionSegment)
  ) {
    return null;
  }

  return {
    requestIdSegment,
    fileIdSegment,
    extensionSegment: extensionSegment.toLowerCase(),
  };
};

const toSignedAttachmentResult = (
  attachment: Pick<
    SupportAttachmentRecord,
    | "id"
    | "original_filename"
    | "stored_filename"
    | "content_type"
    | "size_bytes"
  >,
  signedUrl: string | null,
) => ({
  id: attachment.id,
  original_filename: attachment.original_filename,
  stored_filename: attachment.stored_filename,
  content_type: attachment.content_type,
  size_bytes: attachment.size_bytes,
  signed_url: signedUrl,
});

const createSafeSupportAttachmentSignedUrl = async (
  adminClient: SupabaseAdminClient,
  rawStoragePath: string | null,
  expiresInSeconds: number,
) => {
  if (typeof rawStoragePath !== "string") {
    return { data: null, error: new Error("Invalid storage path.") };
  }

  const safePathParts = getSafeSupportAttachmentPathParts({
    storage_bucket: SUPPORT_ATTACHMENT_BUCKET,
    storage_path: rawStoragePath,
  });
  if (!safePathParts) {
    return { data: null, error: new Error("Invalid storage path.") };
  }

  const canonicalStoragePath = `${safePathParts.requestIdSegment}/` +
    `${safePathParts.fileIdSegment}.${safePathParts.extensionSegment}`;
  if (
    canonicalStoragePath.includes("../") ||
    canonicalStoragePath.includes("..\\")
  ) {
    return { data: null, error: new Error("Invalid storage path.") };
  }

  return adminClient.storage
    .from(SUPPORT_ATTACHMENT_BUCKET)
    .createSignedUrl(canonicalStoragePath, expiresInSeconds);
};

export const handleSupportAction = async (
  context: SuperOpsContext,
): Promise<Response | null> => {
  const {
    action,
    payload,
    adminClient,
    user,
    profile,
    jsonResponse,
    writeAudit,
  } = context;

  const writeSupportRequestEvent = async (
    supportRequestId: string,
    eventType: string,
    metadata: Record<string, unknown> | null = null,
  ) => {
    await adminClient.from("support_request_events").insert({
      support_request_id: supportRequestId,
      actor_id: user.id,
      actor_email: profile.auth_email ?? user.email ?? null,
      event_type: eventType,
      metadata,
    });
  };

  const buildSupportRequestDetail = async (supportRequestId: string) => {
    const { data: request, error: requestError } = await adminClient
      .from("support_requests")
      .select(
        "id, requester_name, reply_email, subject, category, message, source, status, assigned_to, internal_notes, created_at, updated_at",
      )
      .eq("id", supportRequestId)
      .single();

    if (requestError || !request) {
      return { error: "Support request not found.", data: null };
    }

    const [
      { data: attachments, error: attachmentsError },
      { data: events, error: eventsError },
    ] = await Promise.all([
      adminClient
        .from("support_request_attachments")
        .select(
          "id, original_filename, stored_filename, content_type, size_bytes, storage_bucket, storage_path",
        )
        .eq("support_request_id", supportRequestId)
        .order("created_at", { ascending: true }),
      adminClient
        .from("support_request_events")
        .select("id, actor_id, actor_email, event_type, metadata, created_at")
        .eq("support_request_id", supportRequestId)
        .order("created_at", { ascending: true }),
    ]);

    if (attachmentsError || eventsError) {
      return { error: "Unable to load support request details.", data: null };
    }

    let assignedToEmail: string | null = null;
    if (request.assigned_to) {
      const { data: assignedProfile } = await adminClient
        .from("profiles")
        .select("auth_email")
        .eq("id", request.assigned_to)
        .single();
      assignedToEmail = assignedProfile?.auth_email ?? null;
    }

    const signedAttachments = await Promise.all(
      ((attachments ?? []) as SupportAttachmentRecord[]).map(
        async (attachment) => {
          if (!getSafeSupportAttachmentPathParts(attachment)) {
            return toSignedAttachmentResult(attachment, null);
          }

          const { data: signedData, error: signedError } =
            await createSafeSupportAttachmentSignedUrl(
              adminClient,
              attachment.storage_path,
              60 * 60,
            );

          return toSignedAttachmentResult(
            attachment,
            signedError ? null : signedData?.signedUrl ?? null,
          );
        },
      ),
    );

    return {
      error: null,
      data: {
        ...request,
        assigned_to_email: assignedToEmail,
        attachments: signedAttachments,
        events: events ?? [],
      },
    };
  };

  if (action === "list_support_requests") {
    const next = payload;
    const search = optionalPostgrestSearchText(next.search, { maxLen: 120 });
    const status = optionalText(next.status, { maxLen: 40 });
    const limit = optionalInteger(next.limit, 1, 200, 100);
    const allowedStatuses = new Set<SupportRequestStatus>([
      "open",
      "in_progress",
      "resolved",
      "spam",
    ]);

    let query = adminClient
      .from("support_requests")
      .select(
        "id, requester_name, reply_email, subject, category, status, created_at, updated_at, assigned_to",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && allowedStatuses.has(status as SupportRequestStatus)) {
      query = query.eq("status", status);
    } else if (status) {
      return jsonResponse(400, { error: "Invalid support request status." });
    }

    if (search) {
      query = query.or(
        `requester_name.ilike.%${search}%,reply_email.ilike.%${search}%,subject.ilike.%${search}%,message.ilike.%${search}%`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(400, { error: "Unable to load support requests." });
    }

    return jsonResponse(200, { data: { requests: data ?? [] } });
  }

  if (action === "get_support_request") {
    const next = payload;
    const supportRequestId = requireUuid(next.support_request_id);

    const detail = await buildSupportRequestDetail(supportRequestId);
    if (detail.error || !detail.data) {
      return jsonResponse(400, {
        error: detail.error ?? "Unable to load support request.",
      });
    }

    return jsonResponse(200, { data: { request: detail.data } });
  }

  if (action === "update_support_request") {
    const next = payload;
    const supportRequestId = requireUuid(next.support_request_id);
    const status = next.status === undefined
      ? undefined
      : optionalText(next.status, { maxLen: 40 }) as SupportRequestStatus;
    const internalNotes = next.internal_notes === undefined
      ? undefined
      : optionalText(next.internal_notes, { maxLen: 4000 });
    const assignToMe = next.assign_to_me === true;
    const clearAssignment = next.clear_assignment === true;
    const allowedStatuses = new Set<SupportRequestStatus>([
      "open",
      "in_progress",
      "resolved",
      "spam",
    ]);

    if (status && !allowedStatuses.has(status)) {
      return jsonResponse(400, { error: "Invalid support request status." });
    }
    if (assignToMe && clearAssignment) {
      return jsonResponse(400, { error: "Invalid assignment request." });
    }

    const { data: existing, error: existingError } = await adminClient
      .from("support_requests")
      .select("id, status, internal_notes, assigned_to")
      .eq("id", supportRequestId)
      .single();

    if (existingError || !existing) {
      return jsonResponse(400, { error: "Support request not found." });
    }

    const updates: Record<string, unknown> = {};
    const eventMetadata: Record<string, unknown> = {};

    if (status && status !== existing.status) {
      updates.status = status;
      eventMetadata.status = { from: existing.status, to: status };
    }

    if (
      internalNotes !== undefined &&
      internalNotes !== (existing.internal_notes ?? "")
    ) {
      updates.internal_notes = internalNotes || null;
      eventMetadata.internal_notes_updated = true;
    }

    if (assignToMe && existing.assigned_to !== user.id) {
      updates.assigned_to = user.id;
      eventMetadata.assignment = {
        from: existing.assigned_to,
        to: user.id,
      };
    } else if (clearAssignment && existing.assigned_to !== null) {
      updates.assigned_to = null;
      eventMetadata.assignment = {
        from: existing.assigned_to,
        to: null,
      };
    }

    if (Object.keys(updates).length === 0) {
      const detail = await buildSupportRequestDetail(supportRequestId);
      if (detail.error || !detail.data) {
        return jsonResponse(400, {
          error: detail.error ?? "Unable to load support request.",
        });
      }
      return jsonResponse(200, { data: { request: detail.data } });
    }

    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await adminClient
      .from("support_requests")
      .update(updates)
      .eq("id", supportRequestId);

    if (updateError) {
      return jsonResponse(400, {
        error: "Unable to update support request.",
      });
    }

    await writeSupportRequestEvent(
      supportRequestId,
      "updated",
      eventMetadata,
    );
    await writeAudit(
      "update_support_request",
      "support_request",
      supportRequestId,
      eventMetadata,
    );

    const detail = await buildSupportRequestDetail(supportRequestId);
    if (detail.error || !detail.data) {
      return jsonResponse(400, {
        error: detail.error ?? "Unable to load support request.",
      });
    }

    return jsonResponse(200, { data: { request: detail.data } });
  }

  return null;
};
