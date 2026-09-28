import { useNavigate } from "react-router";
import { BookPicker } from "@/components/books";
import { Card, PageHeader } from "@/components/ui";
import { useConfig } from "@/lib/config";
import { useDocumentTitle } from "@/lib/hooks";

export function AddBookPage() {
  useDocumentTitle("Find books");
  const navigate = useNavigate();
  const { data: config } = useConfig();
  return (
    <div>
      <PageHeader
        title="Find books"
        description={`Search by title, author or ISBN, then add a book to your library in one tap. Results come from the club catalogue and ${config?.googleBooksEnabled ? "Google Books" : "Open Library"}.`}
      />
      <Card>
        <BookPicker quickAdd pickLabel="Open" onPick={(edition) => navigate(`/books/${edition.id}`)} />
      </Card>
    </div>
  );
}
