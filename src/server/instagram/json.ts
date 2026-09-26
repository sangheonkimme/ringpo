const LARGE_ID = /"(id|user_id|ig_id|recipient_id|sender_id)"\s*:\s*(\d{15,})/g;

/** Instagram ID는 2^53을 넘을 수 있어 JSON.parse 전에 문자열로 바꾼다. */
export function parseJsonWithStringIds(text: string): unknown {
  return JSON.parse(text.replace(LARGE_ID, '"$1":"$2"'));
}
