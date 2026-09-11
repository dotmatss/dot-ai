"use client";

import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 font-sans text-foreground">
        <div role="alert" className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">Application error</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            {error.digest ? `Reference: ${error.digest}` : "An unexpected error occurred while rendering the application."}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
