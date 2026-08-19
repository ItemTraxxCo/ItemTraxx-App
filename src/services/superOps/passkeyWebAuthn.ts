type ServerCredentialDescriptor = {
  id: string;
  type?: "public-key" | string;
  transports?: AuthenticatorTransport[];
};

type ServerCredentialCreationOptions = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: ServerCredentialDescriptor[];
};

type RegistrationResponseJson = Record<string, unknown>;

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
};

const encodeBase64Url = (value: ArrayBuffer) => {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const deserializeCreationOptions = (
  options: Record<string, unknown>,
): PublicKeyCredentialCreationOptions => {
  const parsed = options as unknown as ServerCredentialCreationOptions;
  const nativeParser = (globalThis.PublicKeyCredential as unknown as {
    parseCreationOptionsFromJSON?: (
      value: unknown,
    ) => PublicKeyCredentialCreationOptions;
  } | undefined)?.parseCreationOptionsFromJSON;
  if (nativeParser) return nativeParser(parsed);

  return {
    ...parsed,
    challenge: decodeBase64Url(parsed.challenge),
    user: {
      ...parsed.user,
      id: decodeBase64Url(parsed.user.id),
    },
    excludeCredentials: parsed.excludeCredentials?.map((credential) => ({
      ...credential,
      id: decodeBase64Url(credential.id),
      type: credential.type ?? "public-key",
    })),
  } as PublicKeyCredentialCreationOptions;
};

const serializeCredential = (
  credential: PublicKeyCredential,
): RegistrationResponseJson => {
  const credentialWithJson = credential as PublicKeyCredential & {
    toJSON?: () => unknown;
  };
  if (typeof credentialWithJson.toJSON === "function") {
    return credentialWithJson.toJSON() as unknown as RegistrationResponseJson;
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    response: {
      attestationObject: encodeBase64Url(response.attestationObject),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
    },
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  };
};

export const registerPasskeyWithOptions = async (
  options: Record<string, unknown>,
) => {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.credentials?.create !== "function"
  ) {
    throw new Error("This browser does not support passkeys.");
  }

  const credential = await navigator.credentials.create({
    publicKey: deserializeCreationOptions(options),
  });
  if (
    !credential ||
    typeof PublicKeyCredential === "undefined" ||
    !(credential instanceof PublicKeyCredential)
  ) {
    throw new Error("Passkey registration was cancelled.");
  }
  return serializeCredential(credential);
};
