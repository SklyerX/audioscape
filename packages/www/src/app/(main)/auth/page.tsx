"use client";

import { GithubIcon, GoogleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export default function Page() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-125px)] w-full">
      <div className="w-full max-w-md">
        <h3 className="text-3xl font-semibold">Audioscape dashboard</h3>
        <p className="text-muted-foreground mt-2">
          To access the Audioscape dashboard please continue authentication with
          one of the methods below
        </p>
        <div className="flex flex-col gap-3 mt-5">
          <Button
            className="cursor-pointer"
            variant="outline"
            onClick={() =>
              authClient.signIn.social({
                provider: "google",
                callbackURL: "http://localhost:3000/dashboard", // your frontend URL
              })
            }
          >
            <GoogleIcon />
            Continue with Google
          </Button>
          <Button
            className="cursor-pointer"
            variant="outline"
            onClick={() =>
              authClient.signIn.social({
                provider: "github",
                callbackURL: "http://localhost:3000/dashboard", // your frontend URL
              })
            }
          >
            <GithubIcon />
            Continue with Github
          </Button>
        </div>
      </div>
    </div>
  );
}
