<template>
  <div class="page contact-sales-page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/">Back</RouterLink>
    </div>

    <h1>Contact Support</h1>
    <p class="muted">Send your request and our team will respond from support@itemtraxx.com.</p>

    <section class="card">
      <form class="form" @submit.prevent="handleSend">
        <label>
          Name
          <input
            v-model.trim="fullName"
            type="text"
            required
            maxlength="120"
            placeholder="Your full name"
          />
        </label>

        <label>
          Reply email address
          <input
            v-model.trim="replyEmail"
            type="email"
            required
            placeholder="email@email.org"
          />
        </label>

        <label>
          Category
          <select v-model="category" required>
            <option value="general">General question</option>
            <option value="bug">Bug report</option>
            <option value="billing">Billing</option>
            <option value="access">Access / login</option>
            <option value="feature">Feature request</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          Subject
          <input
            v-model.trim="subject"
            type="text"
            required
            maxlength="160"
            placeholder="What do you need help with?"
          />
        </label>

        <label>
          Message
          <textarea
            v-model.trim="message"
            rows="6"
            maxlength="3000"
            placeholder="Describe the issue or question in as much detail as you need."
          ></textarea>
        </label>

        <label>
          Attach images (optional, max 2 images)
          <input
            ref="attachmentsInput"
            type="file"
            accept="image/*"
            multiple
            @change="handleAttachmentChange"
          />
          <p class="muted">Supported file types: PNG, JPG, WEBP, or GIF. Maximum 2 images, up to 4 MB each.</p>
        </label>

        <ul v-if="attachments.length" class="attachment-list">
          <li v-for="file in attachments" :key="file.filename">
            <span>{{ file.filename }}</span>
            <span class="muted">{{ formatAttachmentSize(file.size_bytes) }}</span>
          </li>
        </ul>

        <label v-if="turnstileSiteKey">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted">Complete the security check to enable send.</p>
        </label>

        <input
          v-model="website"
          type="text"
          class="honeypot"
          autocomplete="off"
          tabindex="-1"
          aria-hidden="true"
        />

        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSending || !canSubmit">
            {{ isSending ? "Sending..." : "Send" }}
          </button>
        </div>
        <p class="submit-legal-note">
          By sending, you agree to <RouterLink to="/legal">Legal</RouterLink>.
        </p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </section>

    <PublicFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { useTurnstile } from "../composables/useTurnstile";
import { submitContactSupportRequest } from "../services/contactSupportService";
import { toUserFacingErrorMessage } from "../services/appErrors";

type Category = "general" | "bug" | "billing" | "access" | "feature";
type SupportAttachment = {
  filename: string;
  content_type: string;
  content_base64: string;
  size_bytes: number;
};

const fullName = ref("");
const replyEmail = ref("");
const category = ref<Category | "other">("general");
const subject = ref("");
const message = ref("");
const website = ref("");
const attachments = ref<SupportAttachment[]>([]);
const attachmentsInput = ref<HTMLInputElement | null>(null);
const isSending = ref(false);
const error = ref("");
const success = ref("");
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);

const setTurnstileContainerRef = (
  el: Element | { $el?: Element } | null
) => {
  if (el instanceof HTMLElement) {
    turnstileContainerRef.value = el;
    return;
  }
  if (el && "$el" in el && el.$el instanceof HTMLElement) {
    turnstileContainerRef.value = el.$el;
    return;
  }
  turnstileContainerRef.value = null;
};

const canSubmit = computed(() => {
  if (!fullName.value || !replyEmail.value || !subject.value || !message.value) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

const formatAttachmentSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileToAttachment = (file: File) =>
  new Promise<SupportAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      const contentBase64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        content_base64: contentBase64,
        size_bytes: file.size,
      });
    };
    reader.readAsDataURL(file);
  });

const handleAttachmentChange = async (event: Event) => {
  error.value = "";
  const target = event.target as HTMLInputElement | null;
  const files = Array.from(target?.files ?? []);
  if (files.length === 0) {
    attachments.value = [];
    return;
  }
  if (files.length > 2) {
    error.value = "Attach up to 2 images.";
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  const invalidType = files.find((file) => !file.type.startsWith("image/"));
  if (invalidType) {
    error.value = "Only image attachments are allowed.";
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  const oversized = files.find((file) => file.size > 4 * 1024 * 1024);
  if (oversized) {
    error.value = `${oversized.name} is larger than 4 MB.`;
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  try {
    attachments.value = await Promise.all(files.map((file) => fileToAttachment(file)));
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to process attachments.");
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
  }
};

const handleSend = () => {
  void send();
};

const send = async () => {
  error.value = "";
  success.value = "";
  if (!canSubmit.value || (turnstileSiteKey && !turnstileToken.value)) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    await submitContactSupportRequest({
      name: fullName.value,
      reply_email: replyEmail.value,
      subject: subject.value,
      category: category.value,
      message: message.value,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      attachments: attachments.value,
    });
    success.value = "Request sent. You will receive a confirmation email from support@itemtraxx.com shortly. Our team will follow up as soon as possible.";
    subject.value = "";
    message.value = "";
    website.value = "";
    attachments.value = [];
    if (attachmentsInput.value) attachmentsInput.value.value = "";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send request.");
  } finally {
    isSending.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch {
        // no-op
      }
    }
  }
};
</script>

<style scoped>
.contact-sales-page {
  max-width: 860px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

@media (max-width: 720px) {
  .contact-sales-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }
}

.honeypot {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.attachment-list {
  margin: 0;
  padding-left: 1.1rem;
}

.attachment-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.submit-legal-note {
  margin: 0.4rem 0 0;
  color: inherit;
  opacity: 0.72;
  font-size: 0.92rem;
}
</style>
