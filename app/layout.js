import "./globals.css";

export const metadata = {
  title: "Portal Pendaftaran | Kuliah di Jordan",
  description: "Platform pendaftaran dan sistem informasi calon mahasiswa Kuliah di Jordan (KDJ).",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
