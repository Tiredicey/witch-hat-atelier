const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input) {
  const data = typeof input === "string" ? enc.encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmac(key, msg) {
  const k = typeof key === "string" ? enc.encode(key) : key;
  const m = typeof msg === "string" ? enc.encode(msg) : msg;
  const ck = await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", ck, m));
}

async function signingKey(secret, dateStamp, region, service) {
  let k = await hmac("AWS4" + secret, dateStamp);
  k = await hmac(k, region);
  k = await hmac(k, service);
  k = await hmac(k, "aws4_request");
  return k;
}

function encodePathSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function amzDateNow() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export async function signRequest({ method, url, body, region, service, accessKey, secretKey }) {
  const u = new URL(url);
  const amzDate = amzDateNow();
  const dateStamp = amzDate.slice(0, 8);
  const payload = body == null ? "" : body;
  const payloadHash = await sha256Hex(payload);

  const headers = {
    "host": u.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map(n => `${n}:${String(headers[n]).trim()}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalUri = u.pathname
    .split("/")
    .map(seg => seg ? encodePathSegment(seg) : "")
    .join("/") || "/";

  const params = [...u.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const canonicalQuery = params.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const sk = await signingKey(secretKey, dateStamp, region, service);
  const signature = toHex(await hmac(sk, stringToSign));

  return {
    "Authorization": `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
}
