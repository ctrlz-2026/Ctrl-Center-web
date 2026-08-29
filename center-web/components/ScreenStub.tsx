import { Card, CardTitle } from "./Card";
import { Stack } from "./Layout";

/** 아직 안 만든 화면 자리. 셸(네비·카드·표·배지·버튼)이 붙는지 먼저 확인하려고
 *  둔 임시 컴포넌트이며, 각 화면이 완성되면 지웁니다. */
export function ScreenStub({
  code,
  title,
  purpose,
}: {
  code: string;
  title: string;
  purpose: string;
}) {
  return (
    <Stack>
      <Card padding={24} gap={12}>
        <CardTitle>
          {code} · {title}
        </CardTitle>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.467,
            fontWeight: 500,
            color: "var(--label-alternative)",
          }}
        >
          {purpose}
        </p>
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.385,
            fontWeight: 500,
            color: "var(--label-assistive)",
          }}
        >
          화면 구현 예정 · 공통 셸 확인용 자리입니다.
        </p>
      </Card>
    </Stack>
  );
}
