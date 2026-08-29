import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", display: "grid", gap: 12 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.025em",
            color: "var(--primary-normal)",
          }}
        >
          CENTER
        </span>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.023em" }}>
          없는 페이지예요
        </h1>
        <p
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--label-alternative)",
          }}
        >
          주소가 바뀌었거나 지워진 화면이에요.
        </p>
        <Link
          href="/login"
          style={{
            marginTop: 8,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--primary-normal)",
          }}
        >
          로그인 화면으로
        </Link>
      </div>
    </main>
  );
}
