import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { DeviceKeyService } from '@mm-services/device-key.service';

@Injectable({
  providedIn: 'root'
})
export class UpdatePasswordService {

  constructor(
    private http: HttpClient,
    private readonly deviceKeyService: DeviceKeyService,
  ) { }

  /**
   * Uses the user api to store a new password
   *
   * Updates are in the style of the /api/v1/users/{username} service, see
   * its documentation for more details.
   *
   * @param      {string} username         The user you wish to update, without org.couchdb.user:
   * @param      {string} currentPassword  Password for Basic Auth
   * @param      {string} newPassword      Password to set
   */
  async update(username: string, currentPassword: string, newPassword: string): Promise<Object> {
    const url = '/api/v1/users/' + username;
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Basic ' + window.btoa(username + ':' + currentPassword)
    });
    const updates = { password: newPassword };
    const result = await this.http.post(url, updates, { headers }).toPromise();

    // The server has just dropped every device key for this user, so the copy held here is no
    // longer trusted by anything. Forgetting it is what makes the next sync provision a new one.
    await this.deviceKeyService.forget();

    return result as Object;
  }
}
