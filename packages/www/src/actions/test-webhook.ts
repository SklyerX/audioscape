"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

async function getHeaders() {
  const hdrs = await headers();
  return { cookie: hdrs.get("cookie") ?? "" };
}

export async function testWebhook(id: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/test-webhook/${id}`,
    { method: "POST", headers: await getHeaders() },
  );

  if (!res.ok) throw new Error(res.statusText);

  revalidatePath(`/dashboard/${id}`);
}
