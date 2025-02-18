import { Box, Table } from '@highlight-run/ui/components'
import { TraceColumnRenderers } from '@pages/Traces/CustomColumns/renderers'
import useLocalStorage from '@rehooks/local-storage'
import {
	ColumnDef,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { isEqual } from 'lodash'
import React, { Key, useCallback, useEffect, useMemo, useRef } from 'react'
import { StringParam, useQueryParam } from 'use-query-params'

import {
	ColumnHeader,
	CustomColumnHeader,
} from '@/components/CustomColumnHeader'
import {
	CustomColumnPopover,
	DEFAULT_COLUMN_SIZE,
	SerializedColumn,
} from '@/components/CustomColumnPopover'
import { AdditionalFeedResults } from '@/components/FeedResults/FeedResults'
import LoadingBox from '@/components/LoadingBox'
import {
	RelatedTrace,
	useRelatedResource,
} from '@/components/RelatedResources/hooks'
import {
	SORT_COLUMN,
	SORT_DIRECTION,
	useSearchContext,
} from '@/components/Search/SearchContext'
import {
	ProductType,
	SortDirection,
	TraceEdge,
} from '@/graph/generated/schemas'
import { MAX_TRACES } from '@/pages/Traces/useGetTraces'
import { useTracesIntegration } from '@/util/integrated'

import {
	DEFAULT_TRACE_COLUMNS,
	HIGHLIGHT_STANDARD_COLUMNS,
} from './CustomColumns/columns'
import { NoTracesFound } from '@pages/Traces/NoTracesFound'

type Props = {
	loading: boolean
	numMoreTraces?: number
	traceEdges: TraceEdge[]
	handleAdditionalTracesDateChange?: () => void
	resetMoreTraces?: () => void
	fetchMoreWhenScrolled: (target: HTMLDivElement) => void
	loadingAfter: boolean
	pollingExpired: boolean
}

const LOADING_AFTER_HEIGHT = 28

export const TracesList: React.FC<Props> = ({
	loading,
	numMoreTraces,
	pollingExpired,
	traceEdges,
	handleAdditionalTracesDateChange,
	resetMoreTraces,
	fetchMoreWhenScrolled,
	loadingAfter,
}) => {
	const { query } = useSearchContext()
	const { integrated } = useTracesIntegration()
	const { resource } = useRelatedResource()
	const trace = resource as RelatedTrace
	const [selectedColumns, setSelectedColumns] = useLocalStorage<
		SerializedColumn[]
	>(`highlight-traces-table-columns`, DEFAULT_TRACE_COLUMNS)
	const [windowSize, setWindowSize] = useLocalStorage(
		'highlight-traces-window-size',
		window.innerWidth,
	)

	// track the window size
	useEffect(() => {
		if (!!setSelectedColumns) {
			const handleResize = () => {
				setWindowSize(window.innerWidth)
			}

			window.addEventListener('resize', handleResize)

			return () => {
				window.removeEventListener('resize', handleResize)
			}
		}
	}, [setSelectedColumns, setWindowSize])

	// reset columns when window size changes
	useEffect(() => {
		if (!!setSelectedColumns) {
			const newSelectedColumns = selectedColumns.map((column) => ({
				...column,
				size:
					HIGHLIGHT_STANDARD_COLUMNS[column.id]?.size ??
					DEFAULT_COLUMN_SIZE,
			}))

			setSelectedColumns(newSelectedColumns)
		}

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [windowSize])

	const [sortColumn, setSortColumn] = useQueryParam(SORT_COLUMN, StringParam)
	const [sortDirection, setSortDirection] = useQueryParam(
		SORT_DIRECTION,
		StringParam,
	)

	const handleSort = useCallback(
		(column: string, direction?: SortDirection | null) => {
			if (
				column === sortColumn &&
				(direction === null || sortDirection === SortDirection.Asc)
			) {
				setSortColumn(undefined)
				setSortDirection(undefined)
			} else {
				const nextDirection =
					direction ??
					(column === sortColumn &&
					sortDirection === SortDirection.Desc
						? SortDirection.Asc
						: SortDirection.Desc)

				setSortColumn(column)
				setSortDirection(nextDirection)
			}
		},
		[setSortColumn, setSortDirection, sortColumn, sortDirection],
	)

	const bodyRef = useRef<HTMLDivElement>(null)
	const enableFetchMoreTraces =
		(!!numMoreTraces || pollingExpired) &&
		!!resetMoreTraces &&
		!!handleAdditionalTracesDateChange

	const columnHelper = createColumnHelper<TraceEdge>()

	const columnData = useMemo(() => {
		const gridColumns: string[] = []
		const columnHeaders: ColumnHeader[] = []
		const columns: ColumnDef<TraceEdge, string>[] = []

		selectedColumns.forEach((column, index) => {
			const first = index === 0

			gridColumns.push(column.size)
			columnHeaders.push({
				id: column.id,
				component: column.label,
				showActions: true,
				onSort: (direction?: SortDirection | null) => {
					handleSort(column.id, direction)
				},
			})

			const accessorFn =
				column.id in HIGHLIGHT_STANDARD_COLUMNS
					? HIGHLIGHT_STANDARD_COLUMNS[column.id].accessor
					: (`node.traceAttributes.${column.id}` as `node.traceAttributes.${string}`)

			const columnType =
				column.id in HIGHLIGHT_STANDARD_COLUMNS
					? HIGHLIGHT_STANDARD_COLUMNS[column.id].type
					: 'string'

			const accessor = columnHelper.accessor(accessorFn, {
				id: column.id,
				cell: ({ row, getValue }) => {
					const ColumnRenderer = TraceColumnRenderers[columnType]

					return (
						<ColumnRenderer
							key={column.id}
							row={row}
							getValue={getValue}
							first={first}
							queryParts={[]}
						/>
					)
				},
			})

			columns.push(accessor)
		})

		// add custom column
		gridColumns.push('25px')
		columnHeaders.push({
			id: 'edit-column-button',
			noPadding: true,
			component: (
				<CustomColumnPopover
					productType={ProductType.Traces}
					selectedColumns={selectedColumns}
					setSelectedColumns={setSelectedColumns}
					standardColumns={HIGHLIGHT_STANDARD_COLUMNS}
					attributeAccessor={(row: TraceEdge) =>
						row.node.traceAttributes
					}
				/>
			),
		})

		return {
			gridColumns,
			columnHeaders,
			columns,
		}
	}, [columnHelper, handleSort, selectedColumns, setSelectedColumns])

	const table = useReactTable({
		data: traceEdges,
		columns: columnData.columns,
		getCoreRowModel: getCoreRowModel(),
	})

	const { rows } = table.getRowModel()

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: () => 38,
		getScrollElement: () => bodyRef.current,
		overscan: 50,
	})

	const totalSize = rowVirtualizer.getTotalSize()
	const virtualRows = rowVirtualizer.getVirtualItems()
	const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0
	let paddingBottom =
		virtualRows.length > 0
			? totalSize - (virtualRows[virtualRows.length - 1]?.end || 0)
			: 0

	if (!loadingAfter) {
		paddingBottom += LOADING_AFTER_HEIGHT
	}

	const handleFetchMoreWhenScrolled = (
		e: React.UIEvent<HTMLDivElement, UIEvent>,
	) => {
		setTimeout(() => {
			fetchMoreWhenScrolled(e.target as HTMLDivElement)
		}, 0)
	}

	const hasQuery = query.trim() !== ''

	if (!loading && !traceEdges.length) {
		return <NoTracesFound integrated={integrated} hasQuery={hasQuery} />
	}

	return (
		<Table display="flex" flexDirection="column" height="full" noBorder>
			<Table.Head>
				<Table.Row gridColumns={columnData.gridColumns}>
					{columnData.columnHeaders.map((header) => (
						<CustomColumnHeader
							key={header.id}
							header={header}
							selectedColumns={selectedColumns}
							setSelectedColumns={setSelectedColumns!}
							standardColumns={HIGHLIGHT_STANDARD_COLUMNS}
							trackingIdPrefix="TracesTableColumn"
							sortColumn={sortColumn}
							sortDirection={sortDirection}
						/>
					))}
				</Table.Row>
				{enableFetchMoreTraces && (
					<Table.Row>
						<Box width="full">
							<AdditionalFeedResults
								maxResults={MAX_TRACES}
								more={numMoreTraces ?? 0}
								type="traces"
								onClick={() => {
									resetMoreTraces()
									handleAdditionalTracesDateChange()
								}}
								pollingExpired={pollingExpired}
							/>
						</Box>
					</Table.Row>
				)}
			</Table.Head>
			{loading ? (
				<LoadingBox />
			) : (
				<Table.Body
					ref={bodyRef}
					overflowY="auto"
					onScroll={handleFetchMoreWhenScrolled}
					hiddenScroll
				>
					{paddingTop > 0 && <Box style={{ height: paddingTop }} />}
					{virtualRows.map((virtualRow) => {
						const row = rows[virtualRow.index]
						const isSelected =
							row.original.node.spanID === trace?.spanID

						return (
							<TracesTableRow
								key={virtualRow.key}
								row={row}
								rowVirtualizer={rowVirtualizer}
								virtualRowKey={virtualRow.key}
								isSelected={isSelected}
								gridColumns={columnData.gridColumns}
								selectedColumnsIds={selectedColumns.map(
									(c) => c.id,
								)}
							/>
						)
					})}

					{paddingBottom > 0 && (
						<Box style={{ height: paddingBottom }} />
					)}

					{loadingAfter && (
						<Box
							style={{
								height: `${LOADING_AFTER_HEIGHT}px`,
							}}
						>
							<LoadingBox />
						</Box>
					)}
				</Table.Body>
			)}
		</Table>
	)
}

type TracesTableRowProps = {
	row: any
	rowVirtualizer: any
	virtualRowKey: Key
	isSelected: boolean
	gridColumns: string[]
	selectedColumnsIds: string[]
}

export const TracesTableRow = React.memo<TracesTableRowProps>(
	({ row, rowVirtualizer, virtualRowKey, isSelected, gridColumns }) => {
		return (
			<Table.Row
				data-index={virtualRowKey}
				gridColumns={gridColumns}
				forwardRef={rowVirtualizer.measureElement}
				selected={isSelected}
			>
				{row.getVisibleCells().map((cell: any) => {
					return (
						<React.Fragment key={cell.column.id}>
							{flexRender(
								cell.column.columnDef.cell,
								cell.getContext(),
							)}
						</React.Fragment>
					)
				})}
			</Table.Row>
		)
	},
	(prevProps, nextProps) => {
		return (
			prevProps.virtualRowKey === nextProps.virtualRowKey &&
			prevProps.isSelected === nextProps.isSelected &&
			isEqual(prevProps.gridColumns, nextProps.gridColumns) &&
			isEqual(prevProps.selectedColumnsIds, nextProps.selectedColumnsIds)
		)
	},
)
