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
        eyebrow="You"
        title="Find books"
        description={`Search by title, author or ISBN, then shelve a book in one tap. Results come from the shared catalogue and ${config?.googleBooksEnabled ? "Google Books" : "Open Library"}.`}
      />
      <Card>
        <BookPicker quickAdd pickLabel="Open" onPick={(edition) => navigate(`/books/${edition.id}`)} />
      </Card>
    </div>
  );
}
