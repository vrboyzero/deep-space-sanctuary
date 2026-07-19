import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";

export interface SerializedOfficeMultipartForm {
  body: Uint8Array;
  contentType: string;
}

/** 复用 Web 标准 serializer 生成匹配 boundary 的 header/body，避免手工拼接 multipart。 */
export async function serializeOfficeMultipartForm(
  form: FormData,
  abortSignal?: AbortSignal,
): Promise<SerializedOfficeMultipartForm> {
  throwIfAborted(abortSignal);
  const request = new Request("https://office.invalid/", {
    method: "POST",
    body: form,
    signal: abortSignal,
  });
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    throw new Error("Office multipart serializer did not provide Content-Type");
  }

  const arrayBuffer = await raceWithAbort(request.arrayBuffer(), abortSignal);
  throwIfAborted(abortSignal);
  return {
    body: new Uint8Array(arrayBuffer),
    contentType,
  };
}
