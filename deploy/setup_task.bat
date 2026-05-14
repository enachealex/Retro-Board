@echo off
schtasks /create /tn "RetroBoardDeploy" /tr "C:\RetroBoard\_deploy\run_deploy.bat" /sc minute /mo 5 /ru SYSTEM /f
echo DONE
