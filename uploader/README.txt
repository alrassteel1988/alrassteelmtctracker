Al Ras Steel MTC Tracker - store PC uploader (Windows)

1. An admin creates an uploader key in the tracker: Settings and uploaders > Add a store PC uploader.
2. On the store PC, unzip this folder, right-click Install.ps1 > "Run with PowerShell"
   (or: powershell -ExecutionPolicy Bypass -File .\Install.ps1).
3. Enter the tracker web address and paste the key. Accept or change the folders.

From then on, every time this Windows user logs on, the uploader:
 - sends new files saved in the MTC inbox folder (e.g. D:\MTC Inbox\ARBM) to the tracker,
   linked to the PO by the PUR# at the start of the file name. "PO" in the name = PO copy.
 - saves approved ERP Excel files as MTC-{PUR#}.xlsx in the Excel folder (e.g. D:\MTC Excel\ARBM).
 - retries anything that failed while offline, every 30 seconds.

Log file: %LOCALAPPDATA%\MTCUploader\uploader.log
To remove: run Uninstall.ps1.
