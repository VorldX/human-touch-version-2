export interface ParsedJsonResponse<T> {
  payload: T | null;
  rawText: string;
}

export async function parseJsonResponse<T>(response: Response): Promise<ParsedJsonResponse<T>> {
  const rawText = await response.text();
  if (!rawText) {
    return { payload: null, rawText: "" };
  }

  try {
    return {
      payload: JSON.parse(rawText) as T,
      rawText
    };
  } catch {
    return {
      payload: null,
      rawText
    };
  }
}

