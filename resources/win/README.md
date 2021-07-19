# The all-in-one USB driver for Windows

To build and sign the driver, check that you have the specified requirements installed and follow the steps below.

## Requirements

- [WDK](https://msdn.microsoft.com/en-us/windows/hardware/gg454513.aspx) (Required for `inf2cat` and `signtool`)
- [DigiCert High Assurance EV Root CA certificate](https://docs.microsoft.com/en-gb/windows-hardware/drivers/install/cross-certificates-for-kernel-mode-code-signing)

## Steps

### Generate the .cat files from the .inf files:
- Bump version number in .inf file
- `inf2cat /driver:. /os:7_X64,7_X86,8_X64,8_X86,6_3_X86,6_3_X64,10_X86,10_X64,Server10_X64`

### Install certificates:

- Get the Tidepool certificate.
- Double-click to install.
- Also install the DigiCert High Assurance EV Root CA certificate downloaded above, as it's needed to cross-sign the Tidepool certificate.
- You can verify the certificates are installed by running `certmgr`.

### Sign all the .cat files using signtool:

In `resources\win`:

- `signtool sign /v /ac "DigiCertHighAssuranceEVRootCA.crt" /tr http://timestamp.digicert.com /td sha256 /fd sha256 /s my /n "Tidepool Project"  /sha1 EC02571EB23521ECF39813F1910157CAA08DE97A *.cat`

### Submit Windows 10 drivers to hardware dashboard for attestation signing

- `cd win10`
- `makecab /f TidepoolUSBDriver.ddf`
- `signtool sign /v /ac "..\DigiCertHighAssuranceEVRootCA.crt" /tr http://timestamp.digicert.com /td sha256 /fd sha256 /s my /n "Tidepool Project" /sha1 4297DE953C8CF10065C31AA717E1302FCD1B9FE4 disk1\TidepoolUSBDriver.cab` (You'll need the hardware token and the password in 1Password - if the SafeNet client does not prompt you for a password, you're not using the right certificate)

This can then be submitted to the hardware dashboard at: https://partner.microsoft.com/en-us/dashboard/hardware/ (search 1Password for Azure AD login details)

Download the signed drivers from the hardware portal and update the `resources/win/win10` directory.

### Verify that drivers are correctly signed:

	signtool verify /kp /v /c tidepoolvcp.cat amd64\ftser2k.sys
	signtool verify /kp /v /c tidepoolvcp.cat i386\ftser2k.sys
	signtool verify /kp /v /c tidepoolvcp.cat amd64\silabser.sys
	signtool verify /kp /v /c tidepoolvcp.cat i386\silabser.sys
	signtool verify /kp /v /c tidepoolvcp.cat amd64\tiusb.sys
	signtool verify /kp /v /c tidepoolvcp.cat i386\tiusb.sys
	signtool verify /kp /v /c tidepoolvcp.cat amd64\ser2pl64.sys
	signtool verify /kp /v /c tidepoolvcp.cat i386\ser2pl.sys
	signtool verify /kp /v /c tidepoolusb.cat amd64\wdfcoinstaller01009.dll

## Notes

- If the drivers fail to install, make sure all devices are unplugged.
- You must have administrator privileges to install drivers.

For more details on attestation signing, see:
- https://www.davidegrayson.com/signing/
- https://docs.microsoft.com/en-gb/windows-hardware/drivers/dashboard/attestation-signing-a-kernel-driver-for-public-release#test-your-driver-on-windows-10
