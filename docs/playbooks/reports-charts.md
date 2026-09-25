# Reports chart XML (shapes when charts are warranted)

Generate charts with these XML formats when the user asked for a report, chart, analytics, trends, or overview — never only describe charts in prose. Skip charts for simple count questions.

## Bar

## Bar

```
<chart type="bar" title="Monthly Sales" color="blue">
<chart-data label="Sales ($)">
<bar category="Jan" value="50000" percentage="80"/>
<bar category="Feb" value="62500" percentage="100"/>
</chart-data>
</chart>
```

## Line

```
<chart type="line" title="Sales Trend" color="green">
<chart-data label="Revenue ($)">
<point period="Q1" value="150000"/>
<point period="Q2" value="180000"/>
</chart-data>
</chart>
```

## Pie

```
<chart type="pie" title="Sales by Status">
<chart-data label="Amount">
<slice label="Paid" value="75000" percentage="60"/>
<slice label="Pending" value="50000" percentage="40"/>
</chart-data>
</chart>
```

## KPI / gauge / trend

```
<stats>
<stat label="Total Sales" value="$125,000" icon="dollar" color="green"/>
<stat label="Growth Rate" value="15%" icon="chart" color="blue"/>
</stats>
```

```
<gauge title="Sales Goal Progress" status="success">
<current value="$125,000"/>
<target value="$150,000"/>
<percentage value="83%"/>
</gauge>
```

```
<trend label="Monthly Growth" direction="up" color="green">
<current value="$62,500"/>
<change value="$12,500" percentage="25%"/>
</trend>
```

## Minimum report output

**New reports only** (first ask for a report/chart/analytics/trends/overview). Skip this pack for revisions — keep the prior report and change only what the user asked for.

1. Executive summary
2. KPI cards (`<stats>`)
3. At least one `<chart>`
4. Detailed `<table>`
5. `<trend>` or `<gauge>` when goals/period comparison apply
