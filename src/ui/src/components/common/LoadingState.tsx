import { Spinner } from "../ui/spinner";

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <Spinner />
    </div>
  );
}
