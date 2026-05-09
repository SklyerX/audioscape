"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

export const createAPIKey = async (
  name: string,
  expiry: string,
  url: string | null,
) => {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/create`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        expiresAt: expiry === "never" ? null : expiry,
        webhookUrl: url === "" ? null : url,
      }),
      headers: {
        "Content-Type": "application/json",
        cookie: (await headers()).get("cookie") ?? "",
      },
    },
  );

  if (!res.ok) {
    console.log(await res.text());
    throw new Error("Something went wrong while fetching api", {
      cause: res.statusText,
    });
  }

  const data = await res.json();

  revalidatePath("/dashboard");

  return data.data;
};
