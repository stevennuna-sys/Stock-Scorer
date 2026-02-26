export const metadata = {
  title: "Stock Opportunity Scorer",
  description: "Quantitative stock scoring with auto-fill from Yahoo Finance",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
