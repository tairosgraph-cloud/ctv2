export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-xs italic text-slate-400 dark:text-slate-500">
        {message}
      </td>
    </tr>
  )
}
