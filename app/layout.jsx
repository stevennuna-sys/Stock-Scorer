export const metadata = {
  title: "Stock Opportunity Scorer",
  description: "Stock scoring dashboard"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
