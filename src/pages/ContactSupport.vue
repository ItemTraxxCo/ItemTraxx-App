<template>
  <div class="page contact-sales-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <div class="page-nav-left pricing-top-nav">
      <RouterLink class="pricing-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </RouterLink>
      <span class="pricing-breadcrumb"> </span>
    </div>

    <div class="page-intro">
      <h1>Contact Support</h1>
      <p class="muted">Send your request and our team will respond within 48 hours.</p>
    </div>

    <section class="support-section">
      <form class="form support-form" @submit.prevent="handleSend">
        <label class="field">
          Name
          <input
            v-model.trim="fullName"
            type="text"
            required
            maxlength="120"
            placeholder="Your full name"
          />
        </label>

        <label class="field">
          Reply email address
          <input
            v-model.trim="replyEmail"
            type="email"
            required
            placeholder="email@email.org"
          />
        </label>

        <label class="field">
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

        <label class="field">
          Subject
          <input
            v-model.trim="subject"
            type="text"
            required
            maxlength="160"
            placeholder="What do you need help with?"
          />
        </label>

        <label class="field field-full">
          Message
          <textarea
            v-model.trim="message"
            rows="6"
            maxlength="3000"
            placeholder="Describe the issue or question in as much detail as you need."
          ></textarea>
        </label>

        <label class="field field-full">
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

        <ul v-if="attachments.length" class="attachment-list field-full">
          <li v-for="file in attachments" :key="file.filename">
            <span>{{ file.filename }}</span>
            <span class="muted">{{ formatAttachmentSize(file.size_bytes) }}</span>
          </li>
        </ul>

        <label v-if="turnstileSiteKey" class="field field-full">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted security-note">Complete the security check to enable send.</p>
        </label>

        <input
          v-model="website"
          type="text"
          class="honeypot"
          autocomplete="off"
          tabindex="-1"
          aria-hidden="true"
        />

        <div class="form-actions field-full">
          <button type="submit" class="button-primary" :disabled="isSending || !canSubmit">
            {{ isSending ? "Sending..." : "Submit Support Request" }}
          </button>
        </div>
        <p class="submit-legal-note field-full">
          By clicking Submit Support Request, you agree to our <RouterLink to="/privacy">Privacy Policy</RouterLink> and <RouterLink to="/legal">Terms of Service</RouterLink>.
        </p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <PublicFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { useTurnstile } from "../composables/useTurnstile";
import { submitContactSupportRequest } from "../services/contactSupportService";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { saveSubmissionConfirmation } from "../services/submissionConfirmation";

type Category = "general" | "bug" | "billing" | "access" | "feature";
type SupportAttachment = {
  filename: string;
  content_type: string;
  content_base64: string;
  size_bytes: number;
};

const router = useRouter();
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
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);
let themeObserver: MutationObserver | null = null;

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
  if (!canSubmit.value || (turnstileSiteKey && !turnstileToken.value)) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    const response = await submitContactSupportRequest({
      name: fullName.value,
      reply_email: replyEmail.value,
      subject: subject.value,
      category: category.value,
      message: message.value,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      attachments: attachments.value,
    });

    saveSubmissionConfirmation({
      kind: "Support request",
      title: "Support request sent.",
      lead: "Your support request was submitted. We will follow up from support@itemtraxx.com as soon as possible.",
      submittedAt: new Date().toISOString(),
      referenceId: response?.request_id ?? null,
      fields: [
        { label: "Reply email", value: replyEmail.value },
        { label: "Name", value: fullName.value },
        { label: "Category", value: category.value },
        { label: "Subject", value: subject.value },
      ],
    });

    await router.push({ name: "public-submit-confirmation" });
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

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.contact-sales-page {
  max-width: 1080px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  margin-bottom: 0.45rem;
}

.brand-mark-full {
  height: 5.8rem;
  width: auto;
  object-fit: contain;
  display: block;
}

.pricing-top-nav {
  margin-bottom: 1rem;
}

.pricing-back-link {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.46) 0%, rgba(17, 23, 32, 0.34) 100%);
  backdrop-filter: blur(2px);
  color: #ffffff;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.pricing-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
}

.pricing-back-link svg {
  width: 1.2rem;
  height: 1.2rem;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.pricing-breadcrumb {
  color: rgba(225, 232, 240, 0.72);
  font-size: 0.95rem;
}

.page-intro {
  display: grid;
  gap: 0.45rem;
  margin-bottom: 1rem;
}

.page-intro h1 {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 1.06;
  letter-spacing: -0.05em;
}

.page-intro .muted {
  margin: 0;
  max-width: 62ch;
  line-height: 1.55;
}

.support-section {
  margin-bottom: 0.6rem;
}

.support-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.2rem;
}

.field {
  min-width: 0;
  margin-top: 0;
}

.field-full {
  grid-column: 1 / -1;
}

.support-form :is(input, select, textarea) {
  box-shadow: 0 1px 3px color-mix(in srgb, #000 10%, transparent);
}

@media (max-width: 720px) {
  .contact-sales-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .page-intro {
    margin-bottom: 0.85rem;
  }

  .support-form {
    grid-template-columns: 1fr;
    gap: 0.85rem;
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
  padding: 0.1rem 0 0.1rem 1.1rem;
}

.attachment-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.submit-legal-note {
  margin: 0.4rem 0 1.25rem;
  padding-bottom: 0.85rem;
  border-bottom: 2px solid color-mix(in srgb, var(--border) 78%, transparent);
  color: inherit;
  opacity: 0.72;
  font-size: 0.92rem;
}

.security-note {
  font-size: 0.84rem;
}

.form-actions .button-primary:disabled {
  background: color-mix(in srgb, var(--surface-2) 84%, #8b9097 16%);
  border-color: color-mix(in srgb, var(--border) 78%, #8b9097 22%);
  color: color-mix(in srgb, currentColor 65%, transparent);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.8;
}
</style>
