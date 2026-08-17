import BlindDecrypt from "./blind-decrypt"

export const metadata = {
  title: "Encrypted link — URL Compiler",
  robots: { index: false, follow: false },
}

export default async function BlindPage({
  params,
}: {
  params: Promise<{ payload: string }>
}) {
  const { payload } = await params
  return <BlindDecrypt payload={payload} />
}
