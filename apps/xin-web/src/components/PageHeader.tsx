"use client";

import { useRouter } from "next/navigation";

/** Page title row with back control (secondary screens without LHS rail). */
export default function PageHeader({
  title,
  backHref = "/",
}: {
  title: string;
  backHref?: string;
}) {
  const router = useRouter();

  return (
    <div className="page-header">
      <button
        type="button"
        className="icon-btn page-back-btn"
        title="Back"
        aria-label="Back"
        onClick={() => router.push(backHref)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1>{title}</h1>
    </div>
  );
}
