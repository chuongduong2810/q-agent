**Test Type:** Automation

**Summary:** Login with Valid Credentials

**Objective:** Verify that a registered user can successfully log in using valid credentials.

### Preconditions

* The application is running.
* A valid user account exists.
* The user is logged out.

### Test Data

| Parameter | Value                                       |
| --------- | ------------------------------------------- |
| Username  | [test@example.com](mailto:test@example.com) |
| Password  | Password123!                                |

### Test Steps

| Step | Action                                                                     | Data                                        | Expected Result                      |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ |
| 1    | Navigate to the Login page.                                                | -                                           | Login page is displayed.             |
| 2    | Enter the username.                                                        | [test@example.com](mailto:test@example.com) | Username is entered successfully.    |
| 3    | Enter the password.                                                        | Password123!                                | Password is entered successfully.    |
| 4    | Click the **Login** button.                                                | -                                           | User is redirected to the Dashboard. |
| 5    | Verify the logged-in user information displayed in the application header. | -                                           | The correct user name is displayed.  |

### Expected Result

The user is successfully authenticated and gains access to the Dashboard without any errors.

### Postconditions

* User session is active.
* Dashboard is accessible.

### Labels

authentication, login, smoke, regression

### Priority

High
