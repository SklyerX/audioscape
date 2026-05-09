"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

async function getHeaders() {
  const hdrs = await headers();
  return { cookie: hdrs.get("cookie") ?? "" };
}

export async function revokeKey(id: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/revoke/${id}`,
    { method: "POST", headers: await getHeaders() },
  );

  if (!res.ok) throw new Error(res.statusText);

  revalidatePath(`/dashboard/${id}`);
  revalidatePath("/dashboard");
}

export async function rotateSecret(id: string): Promise<string> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/rotate-secret/${id}`,
    { method: "POST", headers: await getHeaders() },
  );

  if (!res.ok) throw new Error(res.statusText);

  const json = await res.json();
  return json.data.webhook_secret;
}

export async function updateKey(
  id: string,
  data: { name?: string; webhookUrl?: string; expiresAt?: string },
) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/update/${id}`,
    {
      method: "PATCH",
      headers: { ...(await getHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!res.ok) {
    console.log(await res.text());
    throw new Error(res.statusText);
  }

  revalidatePath(`/dashboard/${id}`);
  revalidatePath("/dashboard");
}
