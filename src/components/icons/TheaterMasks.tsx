import type { SVGProps } from "react";

export function TheaterMasks(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Happy mask (left, behind) */}
      <path d="M2 4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6a6 6 0 0 1-6 6H6a6 6 0 0 1-5.65-4A2 2 0 0 1 2 4z" />
      <circle cx="5.5" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <path d="M5 9.5c.5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5" />

      {/* Sad mask (right, front) */}
      <path d="M11 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.65-4A2 2 0 0 1 11 8z" />
      <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="19" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <path d="M14.5 15c.5-1 1.5-1.5 2.5-1.5s2 .5 2.5 1.5" />
    </svg>
  );
}
